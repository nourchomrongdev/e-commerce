const { QueryTypes } = require("sequelize");
const jwt = require("jsonwebtoken");
const { sequelize } = require("../models");
const { findByToken, jwtSecret } = require("./authHelpers");
const { createPayPalOrder, capturePayPalOrder, getPayPalOrder, deletePayPalVaultToken, getPayPalVaultToken, getPayPalConfigurationStatus, createPayPalVaultSetupToken, createPayPalVaultPaymentToken } = require("../services/paypalService");
const { encryptPayPalVaultToken, decryptPayPalVaultToken } = require("../services/paypalVaultTokenService");
const finance = require("../services/creatorFinanceService");
const { createABAPayWayPayment, submitABAPayWayPayment, checkABAPayWayTransaction, getPayWayConfigurationStatus } = require("../services/paywayService");
const { issueOrderLicenses, applyRefundLicensePolicy } = require("../services/licenseService");
const { createNotification } = require("../services/notificationService");
const ORDER_PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

type ProductPricingRow = {
  ProductId: number;
  ProductName: string;
  Currency: string | null;
  StorefrontId: number;
  CreatorUserId: number;
  CurrentPrice: number | string | null;
  CurrentVersionId: number | null;
  CurrentLicenseTypeId: number | null;
  DiscountType: string | null;
  DiscountAmount: number | string | null;
};

function getPaymentProviderStatus(req, res) {
  return res.json({
    paypal: getPayPalConfigurationStatus(),
    abayapayway: getPayWayConfigurationStatus(),
  });
}

async function getAuthenticatedUser(req) {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return null;
  return findByToken(authorization.slice(7));
}

async function requireUser(req, res) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return null;
    }
    return user;
  } catch {
    res.status(401).json({ error: "Invalid or expired authentication token." });
    return null;
  }
}

async function orderContainsProductsFromUserStore(orderId, userId) {
  const [result] = await sequelize.query(
    `SELECT EXISTS (
       SELECT 1
       FROM "OrderItems" oi
       JOIN "Storefronts" s ON s."StorefrontId" = oi."StorefrontId"
       JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
       WHERE oi."OrderId" = :orderId AND cp."UserId" = :userId
     ) AS "containsOwnProduct"`,
    { replacements: { orderId, userId }, type: QueryTypes.SELECT },
  );
  return Boolean(result?.containsOwnProduct);
}

async function orderHasOtherSuccessfulPurchase(orderId, userId, transaction = undefined) {
  const [result] = await sequelize.query(
    `SELECT EXISTS (
       SELECT 1
       FROM "OrderItems" current_item
       JOIN "OrderItems" prior_item ON prior_item."ProductId" = current_item."ProductId"
       JOIN "Orders" prior_order ON prior_order."OrderId" = prior_item."OrderId"
       WHERE current_item."OrderId" = :orderId
         AND prior_order."UserId" = :userId
         AND prior_order."OrderId" <> :orderId
         AND NOT COALESCE(current_item."AllowRepurchase", FALSE)
         AND (
           prior_order."Status" IN ('paid', 'completed')
           OR EXISTS (
             SELECT 1 FROM "Payments" prior_payment
             WHERE prior_payment."OrderId" = prior_order."OrderId"
               AND prior_payment."Status" = 'paid'
           )
         )
     ) AS "alreadyPurchased"`,
    { replacements: { orderId, userId }, type: QueryTypes.SELECT, transaction },
  );
  return Boolean(result?.alreadyPurchased);
}

async function notifyOrderPaid(orderId, transaction) {
  const [order] = await sequelize.query(
    `SELECT "UserId" AS "userId", "OrderNumber" AS "orderNumber"
     FROM "Orders" WHERE "OrderId" = :orderId`,
    { replacements: { orderId }, type: QueryTypes.SELECT, transaction },
  );
  if (!order) throw new Error("Cannot notify about a paid order that no longer exists.");

  const orderLabel = String(order.orderNumber || orderId);
  await createNotification(order.userId, {
    type: "order.paid",
    title: "Payment confirmed",
    message: `Your payment for order ${orderLabel} has been confirmed.`,
    relatedEntityType: "order",
    relatedEntityId: orderId,
    href: "/buyer/purchases",
    dedupeKey: `order-paid:buyer:${orderId}`,
  }, { transaction });

  const creators = await sequelize.query(
    `SELECT DISTINCT cp."UserId" AS "userId"
     FROM "OrderItems" oi
     JOIN "Storefronts" s ON s."StorefrontId" = oi."StorefrontId"
     JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
     WHERE oi."OrderId" = :orderId`,
    { replacements: { orderId }, type: QueryTypes.SELECT, transaction },
  );
  await Promise.all(creators.map((creator) => createNotification(creator.userId, {
    type: "order.sale",
    title: "New sale",
    message: `A purchase in order ${orderLabel} has been paid.`,
    relatedEntityType: "order",
    relatedEntityId: orderId,
    href: "/creator/overview",
    dedupeKey: `order-paid:creator:${orderId}:${creator.userId}`,
  }, { transaction })));
}

function normalizePaymentStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  const mapping = {
    pending: "pending",
    awaiting: "pending",
    authorized: "authorized",
    success: "paid",
    succeeded: "paid",
    completed: "paid",
    paid: "paid",
    "0": "paid",
    "00": "paid",
    failed: "failed",
    "1": "failed",
    "2": "failed",
    cancelled: "cancelled",
    canceled: "cancelled",
    refunded: "refunded",
  };
  return mapping[raw] || raw || "pending";
}

function getProviderErrorMessage(error, provider) {
  if (error?.statusCode === 503 && error.message) return error.message;
  if (provider === "paypal") {
    if (error?.statusCode === 401) return "PayPal rejected the sandbox credentials. Check the PayPal client ID and secret in backend_service/.env, then restart the backend.";
    if (error?.statusCode === 403) return "The PayPal sandbox app does not have permission for this checkout. Check its sandbox account and payment capabilities.";
    if (!error?.statusCode) {
      const networkCode = error?.cause?.code;
      return networkCode
        ? `Could not connect to PayPal sandbox (${networkCode}). Check that the backend can make outbound HTTPS requests and verify PAYPAL_API_BASE_URL.`
        : "Could not connect to PayPal sandbox. Check that the backend can make outbound HTTPS requests and verify PAYPAL_API_BASE_URL.";
    }
    const paypalDetail = Array.isArray(error?.details?.details)
      ? error.details.details.find((detail) =>
          (detail?.issue || detail?.description) &&
          !(detail.issue === "UNPROCESSABLE_ENTITY" && detail.description === "UNPROCESSABLE_ENTITY"),
        )
      : null;
    if (paypalDetail) {
      const field = paypalDetail.field ? ` (${paypalDetail.field})` : "";
      const issue = paypalDetail.issue ? ` [${paypalDetail.issue}]` : "";
      return `${paypalDetail.description || error.message}${field}${issue}`;
    }
    if (error?.statusCode === 422) {
      const debugId = error.details?.debug_id ? ` PayPal reference: ${error.details.debug_id}.` : "";
      return `PayPal rejected this order. Verify the amount is valid in USD and the Sandbox app supports the selected payment method.${debugId}`;
    }
    return error.message || "PayPal could not start this sandbox payment. Check the order details and try again.";
  }
  if (!error?.statusCode) return "Could not prepare ABA PayWay sandbox checkout. Check the backend configuration and try again.";
  return error.message || "ABA PayWay could not start this sandbox payment. Check the merchant settings and try again.";
}

async function createPaymentOrder(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const orderId = Number(req.body.orderId);
  const saveCard = req.body.saveCard === true;
  const cardFields = req.body.cardFields === true;
  const savedCardId = req.body.savedCardId === undefined || req.body.savedCardId === null
    ? null
    : Number(req.body.savedCardId);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return res.status(400).json({ error: "A valid orderId is required." });
  if (savedCardId !== null && (!Number.isSafeInteger(savedCardId) || savedCardId <= 0)) {
    return res.status(400).json({ error: "A valid savedCardId is required." });
  }
  if (savedCardId !== null && (saveCard || cardFields)) {
    return res.status(400).json({ error: "Choose either a saved card or new card details." });
  }

  try {
    const [order] = await sequelize.query(
      `SELECT "OrderId", "OrderNumber", "TotalAmount", "Currency", "Status", "CreatedAt"
       FROM "Orders" WHERE "OrderId" = :orderId AND "UserId" = :userId`,
      { replacements: { orderId, userId: user.UserId }, type: QueryTypes.SELECT },
    );
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (await orderContainsProductsFromUserStore(orderId, user.UserId)) {
      return res.status(403).json({ error: "You cannot purchase products from your own store." });
    }
    if (await orderHasOtherSuccessfulPurchase(orderId, user.UserId)) {
      return res.status(409).json({ error: "A product in this order has already been purchased. This order cannot be paid again." });
    }
    if (Date.now() - new Date(order.CreatedAt).getTime() >= ORDER_PAYMENT_WINDOW_MS) {
      return res.status(410).json({ error: "The 24-hour payment window for this order has expired. Return to your cart to start a new order." });
    }
    if (!["pending", "failed"].includes(order.Status)) return res.status(409).json({ error: "This order is not available for payment." });
    if (String(order.Currency || "").trim().toUpperCase() !== "USD") {
      return res.status(400).json({ error: "PayPal Checkout currently supports USD orders only. Choose ABA PayWay for other currencies." });
    }

    const [existingPayment] = await sequelize.query(
      `SELECT "TransactionId", "Status", "ProviderResponse"
       FROM "Payments" WHERE "OrderId" = :orderId AND "PaymentMethod" = 'paypal'
       ORDER BY "CreatedAt" DESC LIMIT 1`,
      { replacements: { orderId }, type: QueryTypes.SELECT },
    );
    if (existingPayment?.Status === "paid") return res.status(409).json({ error: "This order has already been paid." });
    const checkoutMode = savedCardId !== null
      ? `saved-card:${savedCardId}`
      : saveCard
        ? "card-fields-save"
        : cardFields
          ? "card-fields"
          : "paypal-approval";
    if (existingPayment?.TransactionId && existingPayment.Status === "pending") {
      const response = existingPayment.ProviderResponse || {};
      const existingCheckoutMode = response.checkoutMode ||
        (savedCardId === null && !saveCard && cardFields ? "card-fields" : "paypal-approval");
      if (existingCheckoutMode !== checkoutMode) {
        return res.status(409).json({ error: "A different PayPal checkout is already pending for this order. Complete or cancel it before changing payment methods." });
      }
      const approvalUrl = response.links?.find((link) => link.rel === "approve")?.href || null;
      return res.status(200).json({ paypalOrderId: existingPayment.TransactionId, approvalUrl });
    }

    const [savedMethod] = savedCardId !== null
      ? await sequelize.query(
          `SELECT "PayPalVaultTokenEncrypted", "PayPalCustomerId", "ExpiryMonth", "ExpiryYear"
           FROM "BuyerPayPalVaultMethods"
           WHERE "BuyerPayPalVaultMethodId" = :savedCardId AND "UserId" = :userId`,
          { replacements: { savedCardId, userId: user.UserId }, type: QueryTypes.SELECT },
        )
      : saveCard
      ? await sequelize.query(
          `SELECT "PayPalCustomerId" FROM "BuyerPayPalVaultMethods"
           WHERE "UserId" = :userId AND "PayPalCustomerId" IS NOT NULL
           ORDER BY "CreatedAt" DESC LIMIT 1`,
          { replacements: { userId: user.UserId }, type: QueryTypes.SELECT },
        )
      : [];
    if (savedCardId !== null && !savedMethod) {
      return res.status(404).json({ error: "Saved card not found." });
    }
    if (savedCardId !== null && savedMethod.ExpiryMonth && savedMethod.ExpiryYear) {
      const expiry = new Date(Number(savedMethod.ExpiryYear), Number(savedMethod.ExpiryMonth), 0, 23, 59, 59, 999);
      if (expiry.getTime() <= Date.now()) {
        return res.status(409).json({ error: "This saved card has expired. Choose another card or enter new card details." });
      }
    }
    let vaultId = null;
    if (savedCardId !== null) {
      try {
        vaultId = decryptPayPalVaultToken(savedMethod.PayPalVaultTokenEncrypted);
      } catch (decryptError) {
        console.error("Saved PayPal card could not be decrypted.", decryptError);
        return res.status(500).json({ error: "Saved card could not be used. Choose another card or enter new card details." });
      }
      let paypalVaultToken;
      try {
        paypalVaultToken = await getPayPalVaultToken(vaultId);
      } catch (vaultError) {
        if (vaultError.statusCode === 404) {
          return res.status(409).json({
            error: "PayPal can no longer find this saved card for the current Sandbox app. Remove it and save the card again.",
          });
        }
        throw vaultError;
      }
      if (String(paypalVaultToken.id || "") !== vaultId) {
        return res.status(409).json({
          error: "PayPal could not verify this saved card for the current Sandbox app. Remove it and save the card again.",
        });
      }
      const savedCustomerId = String(savedMethod.PayPalCustomerId || "");
      const paypalCustomerId = String(paypalVaultToken.customer?.id || "");
      if (savedCustomerId && paypalCustomerId && savedCustomerId !== paypalCustomerId) {
        return res.status(409).json({
          error: "This saved card belongs to a different PayPal customer. Remove it and save the card again.",
        });
      }
    }
    const [attemptResult] = await sequelize.query(
      `SELECT COUNT(*) AS "attemptCount"
       FROM "Payments" WHERE "OrderId" = :orderId AND "PaymentMethod" = 'paypal'`,
      { replacements: { orderId }, type: QueryTypes.SELECT },
    );
    const attemptNumber = Number(attemptResult?.attemptCount || 0) + 1;
    const paypalOrder = await createPayPalOrder({
      amount: order.TotalAmount,
      currency: order.Currency,
      referenceId: String(order.OrderId),
      attemptNumber,
      saveCard,
      customerId: savedCardId === null ? savedMethod?.PayPalCustomerId || null : null,
      vaultId,
    });
    const [insertedPayment] = await sequelize.query(
      `INSERT INTO "Payments" ("OrderId", "PaymentMethod", "TransactionId", "Amount", "Currency", "Status", "ProviderResponse")
       VALUES (:orderId, 'paypal', :transactionId, :amount, :currency, 'pending', CAST(:providerResponse AS jsonb))
       ON CONFLICT ("TransactionId") WHERE "TransactionId" IS NOT NULL DO NOTHING
       RETURNING "PaymentId"`,
      {
        replacements: {
          orderId,
          transactionId: paypalOrder.id,
          amount: order.TotalAmount,
          currency: order.Currency,
          providerResponse: JSON.stringify({
            ...stripPayPalVaultTokens(paypalOrder),
            checkoutMode,
            savedCardId,
          }),
        },
        type: QueryTypes.SELECT,
      },
    );
    if (!insertedPayment) {
      const [existingTransaction] = await sequelize.query(
        `SELECT p."OrderId", p."Status", p."ProviderResponse"
         FROM "Payments" p
         WHERE p."TransactionId" = :transactionId AND p."PaymentMethod" = 'paypal'`,
        { replacements: { transactionId: paypalOrder.id }, type: QueryTypes.SELECT },
      );
      if (
        Number(existingTransaction?.OrderId) !== orderId ||
        existingTransaction?.Status === "paid" ||
        existingTransaction?.ProviderResponse?.checkoutMode !== checkoutMode
      ) {
        return res.status(409).json({ error: "PayPal already has a payment attempt for this order. Refresh checkout before retrying." });
      }
    }

    return res.status(201).json({ paypalOrderId: paypalOrder.id, approvalUrl: paypalOrder.links?.find((link) => link.rel === "approve")?.href || null });
  } catch (error) {
    console.error("PayPal order creation failed", {
      name: error.details?.name || null,
      message: error.details?.message || error.message || null,
      statusCode: error.statusCode || null,
      debugId: error.details?.debug_id || null,
      endpoint: error.paypalRequest?.endpoint || null,
      requestMethod: error.paypalRequest?.method || null,
      details: Array.isArray(error.details?.details)
        ? error.details.details.map((detail) => Object.fromEntries(
            ["field", "location", "issue"].flatMap((key) =>
              detail[key] === undefined ? [] : [[key, detail[key]]],
            ),
          ))
        : [],
    });
    return res.status(error.statusCode && error.statusCode < 500 ? error.statusCode : error.statusCode || 502).json({
      error: getProviderErrorMessage(error, "paypal"),
    });
  }
}

function getPayPalMinorUnits(value) {
  const amountString = String(value ?? "").trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(amountString);
  if (!match) return null;

  const minorUnits = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(minorUnits) ? minorUnits : null;
}

async function capturePaymentOrder(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const paypalOrderId = String(req.body.paypalOrderId || "").trim();
  if (!paypalOrderId) return res.status(400).json({ error: "paypalOrderId is required." });

  try {
    const captureResult = await sequelize.transaction(async (transaction) => {
      const [payment] = await sequelize.query(
        `SELECT p."PaymentId", p."OrderId", p."Status", p."Amount" AS "PaymentAmount",
                p."Currency" AS "PaymentCurrency", o."TotalAmount" AS "OrderTotalAmount",
                o."Currency" AS "OrderCurrency", o."Status" AS "OrderStatus"
         FROM "Payments" p JOIN "Orders" o ON o."OrderId" = p."OrderId"
         WHERE p."TransactionId" = :paypalOrderId AND p."PaymentMethod" = 'paypal' AND o."UserId" = :userId
         FOR UPDATE OF p, o`,
        {
          replacements: { paypalOrderId, userId: user.UserId },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      if (!payment) {
        return {
          notFound: true,
          alreadyPaid: false,
          conflict: null,
          payment: null,
          capture: null,
          captureStatus: null,
          captureId: null,
          amountMismatch: false,
          declined: false,
        };
      }
      if (payment.Status === "paid") {
        return {
          notFound: false,
          alreadyPaid: true,
          conflict: null,
          payment: null,
          orderId: payment.OrderId,
          capture: null,
          captureStatus: null,
          captureId: null,
          amountMismatch: false,
          declined: false,
        };
      }
      if (payment.Status !== "pending") {
        return {
          notFound: false,
          alreadyPaid: false,
          conflict: "This PayPal payment attempt is no longer available for capture.",
          payment: null,
          capture: null,
          captureStatus: null,
          captureId: null,
          amountMismatch: false,
          declined: false,
        };
      }
      if (await orderHasOtherSuccessfulPurchase(payment.OrderId, user.UserId, transaction)) {
        return {
          notFound: false,
          alreadyPaid: false,
          conflict: "A product in this order has already been purchased. This payment attempt cannot be captured.",
          payment: null,
          capture: null,
          captureStatus: null,
          captureId: null,
          amountMismatch: false,
          declined: false,
        };
      }
      if (!["pending", "processing"].includes(String(payment.OrderStatus).toLowerCase())) {
        return {
          notFound: false,
          alreadyPaid: false,
          conflict: "This order is no longer available for payment.",
          payment: null,
          capture: null,
          captureStatus: null,
          captureId: null,
          amountMismatch: false,
          declined: false,
        };
      }

      let capture;
      try {
        capture = await capturePayPalOrder(paypalOrderId);
      } catch (captureError) {
        const issues = Array.isArray(captureError.details?.details)
          ? captureError.details.details.map((detail) => detail?.issue).filter(Boolean)
          : [];
        if (captureError.statusCode === 422 && issues.includes("ORDER_ALREADY_CAPTURED")) {
          const existingOrder = await getPayPalOrder(paypalOrderId);
          const existingCapture = existingOrder.purchase_units?.[0]?.payments?.captures?.[0];
          if (
            String(existingOrder.status || "").toUpperCase() !== "COMPLETED" ||
            String(existingCapture?.status || "").toUpperCase() !== "COMPLETED"
          ) {
            throw captureError;
          }
          capture = existingOrder;
        } else if (captureError.statusCode === 422 && issues.includes("INSTRUMENT_DECLINED")) {
          await sequelize.query(
            `UPDATE "Payments"
             SET "Status" = 'failed',
                 "ProviderResponse" = CAST(:providerResponse AS jsonb)
             WHERE "PaymentId" = :paymentId`,
            {
              replacements: {
                providerResponse: JSON.stringify({
                  status: "DECLINED",
                  issues,
                  debugId: captureError.details?.debug_id || null,
                }),
                paymentId: payment.PaymentId,
              },
              transaction,
            },
          );
          return {
            notFound: false,
            alreadyPaid: false,
            conflict: null,
            payment: null,
            capture: null,
            captureStatus: "failed",
            captureId: null,
            amountMismatch: false,
            declined: true,
          };
        } else {
          throw captureError;
        }
      }

      const captureDetails = capture.purchase_units?.[0]?.payments?.captures?.[0];
      const capturedAmount = getPayPalMinorUnits(captureDetails?.amount?.value);
      const orderAmount = getPayPalMinorUnits(payment.OrderTotalAmount);
      const paymentAmount = getPayPalMinorUnits(payment.PaymentAmount);
      const capturedCurrency = String(captureDetails?.amount?.currency_code || "").toUpperCase();
      const expectedCurrency = String(payment.OrderCurrency || "").toUpperCase();
      const captureCompleted =
        String(capture.status || "").toUpperCase() === "COMPLETED" &&
        String(captureDetails?.status || "").toUpperCase() === "COMPLETED";
      const amountMatches =
        capturedAmount !== null &&
        capturedAmount === orderAmount &&
        paymentAmount === orderAmount &&
        capturedCurrency === expectedCurrency &&
        String(payment.PaymentCurrency || "").toUpperCase() === expectedCurrency;
      const captureStatus = captureCompleted && amountMatches ? "paid" : "failed";
      const captureId = captureDetails?.id || paypalOrderId;

      await sequelize.query(
        `UPDATE "Payments"
         SET "Status" = :status,
             "PaidAt" = CASE WHEN :status = 'paid' THEN CURRENT_TIMESTAMP ELSE "PaidAt" END,
             "ProviderResponse" = CAST(:providerResponse AS jsonb)
         WHERE "PaymentId" = :paymentId`,
        {
          replacements: {
            status: captureStatus,
            providerResponse: JSON.stringify(stripPayPalVaultTokens({ ...capture, captureId })),
            paymentId: payment.PaymentId,
          },
          transaction,
        },
      );
      if (captureStatus === "paid") {
        const paypalFee = captureDetails?.seller_receivable_breakdown?.paypal_fee;
        await finance.recordPaidOrderEarnings({
          paymentId: payment.PaymentId,
          transaction,
          providerFee: paypalFee?.value
            ? { amount: paypalFee.value, currency: paypalFee.currency_code }
            : null,
        });
        const [updatedOrder] = await sequelize.query(
          `UPDATE "Orders" SET "Status" = 'paid'
           WHERE "OrderId" = :orderId AND "Status" IN ('pending', 'processing')
           RETURNING "OrderId"`,
          {
            replacements: { orderId: payment.OrderId },
            type: QueryTypes.SELECT,
            transaction,
          },
        );
        if (!updatedOrder) throw new Error("The paid PayPal order could not be transitioned to paid.");
        await notifyOrderPaid(payment.OrderId, transaction);
      }

      return {
        notFound: false,
        alreadyPaid: false,
        conflict: null,
        payment,
        capture,
        captureStatus,
        captureId,
        amountMismatch: captureCompleted && !amountMatches,
        declined: false,
      };
    });
    if (captureResult.notFound) return res.status(404).json({ error: "PayPal payment not found." });
    if (captureResult.alreadyPaid) {
      await issueOrderLicenses(captureResult.orderId);
      return res.json({ status: "COMPLETED", orderId: captureResult.orderId });
    }
    if (captureResult.conflict) return res.status(409).json({ error: captureResult.conflict });
    if (captureResult.declined) {
      return res.status(402).json({ error: "PayPal declined this card. Try a different card or payment method." });
    }
    const { payment, capture, captureStatus, captureId, amountMismatch } = captureResult;
    if (amountMismatch) {
      return res.status(502).json({ error: "PayPal returned a payment amount or currency that does not match the order. The order remains unpaid." });
    }
    if (captureStatus === "paid") await issueOrderLicenses(payment.OrderId);

    let savedCard = null;
    let savedCardAlreadyExists = false;
    if (captureStatus === "paid") {
      const card = getCapturedPayPalCard(capture);
      const vaultToken = String(card?.vault?.id || "").trim();
      if (vaultToken && String(card?.vault?.status || "").toUpperCase() === "VAULTED") {
        try {
          const encrypted = encryptPayPalVaultToken(vaultToken);
          const saveResult = await sequelize.transaction(async (transaction) => {
            await sequelize.query(
              `SELECT "UserId" FROM "UserAccounts" WHERE "UserId" = :userId FOR UPDATE`,
              { replacements: { userId: user.UserId }, transaction },
            );

            const hasCardIdentity =
              Boolean(card.brand) &&
              Boolean(card.lastDigits) &&
              Boolean(card.expiryMonth) &&
              Boolean(card.expiryYear);
            const [existingMethod] = await sequelize.query(
              `SELECT "BuyerPayPalVaultMethodId" AS "id", "CardBrand" AS "brand",
                      "LastDigits" AS "lastDigits", "ExpiryMonth" AS "expiryMonth",
                      "ExpiryYear" AS "expiryYear", "IsDefault" AS "isDefault",
                      "PayPalVaultTokenFingerprint" AS "fingerprint"
               FROM "BuyerPayPalVaultMethods"
               WHERE "UserId" = :userId
                 AND (
                   "PayPalVaultTokenFingerprint" = :fingerprint
                   OR (
                     :hasCardIdentity = TRUE
                     AND LOWER(COALESCE("CardBrand", '')) = LOWER(:brand)
                     AND "LastDigits" = :lastDigits
                     AND "ExpiryMonth" = :expiryMonth
                     AND "ExpiryYear" = :expiryYear
                   )
                 )
               ORDER BY ("PayPalVaultTokenFingerprint" = :fingerprint) DESC, "CreatedAt" DESC
               LIMIT 1`,
              {
                replacements: {
                  userId: user.UserId,
                  fingerprint: encrypted.fingerprint,
                  hasCardIdentity,
                  brand: card.brand || "",
                  lastDigits: card.lastDigits,
                  expiryMonth: card.expiryMonth,
                  expiryYear: card.expiryYear,
                },
                type: QueryTypes.SELECT,
                transaction,
              },
            );
            if (existingMethod) {
              const { fingerprint: existingFingerprint, ...existingCard } = existingMethod;
              return {
                card: existingCard,
                isDuplicate: true,
                isSameVaultToken: existingFingerprint === encrypted.fingerprint,
              };
            }

            const [inserted] = await sequelize.query(
              `INSERT INTO "BuyerPayPalVaultMethods"
                ("UserId", "PayPalVaultTokenEncrypted", "PayPalVaultTokenFingerprint", "PayPalCustomerId", "CardBrand", "LastDigits", "ExpiryMonth", "ExpiryYear", "IsDefault")
               VALUES
                (:userId, :encryptedToken, :fingerprint, :customerId, :brand, :lastDigits, :expiryMonth, :expiryYear,
                 NOT EXISTS (SELECT 1 FROM "BuyerPayPalVaultMethods" WHERE "UserId" = :userId AND "IsDefault" = TRUE))
               ON CONFLICT ("PayPalVaultTokenFingerprint") DO NOTHING
               RETURNING "BuyerPayPalVaultMethodId" AS "id", "CardBrand" AS "brand",
                         "LastDigits" AS "lastDigits", "ExpiryMonth" AS "expiryMonth",
                         "ExpiryYear" AS "expiryYear", "IsDefault" AS "isDefault"`,
              {
                replacements: {
                  userId: user.UserId,
                  encryptedToken: encrypted.encryptedToken,
                  fingerprint: encrypted.fingerprint,
                  customerId: card.customerId || null,
                  brand: card.brand || null,
                  lastDigits: card.lastDigits || null,
                  expiryMonth: card.expiryMonth,
                  expiryYear: card.expiryYear,
                },
                type: QueryTypes.SELECT,
                transaction,
              },
            );
            return { card: inserted || null, isDuplicate: false, isSameVaultToken: false };
          });
          savedCard = saveResult?.card || null;
          savedCardAlreadyExists = Boolean(saveResult?.isDuplicate);
          if (saveResult?.isDuplicate && !saveResult.isSameVaultToken) {
            try {
              await deletePayPalVaultToken(vaultToken);
            } catch (revokeError) {
              console.error("Duplicate PayPal vault token could not be revoked.", {
                statusCode: revokeError.statusCode || null,
                debugId: revokeError.details?.debug_id || null,
              });
            }
          }
        } catch (saveError) {
          console.error("PayPal payment completed, but the vaulted card could not be saved.", saveError);
        }
      } else if (vaultToken) {
        console.warn("PayPal returned a card token that is not ready for reuse.", {
          vaultStatus: card?.vault?.status || null,
        });
      }
    }

    return res.json({
      status: captureStatus === "paid" ? "COMPLETED" : "FAILED",
      orderId: payment.OrderId,
      providerStatus: capture.status || null,
      captureId,
      savedCard,
      savedCardAlreadyExists,
    });
  } catch (error) {
    console.error("PayPal capture failed", {
      name: error.details?.name || error.name || null,
      message: error.details?.message || error.message || null,
      statusCode: error.statusCode || null,
      debugId: error.details?.debug_id || null,
      endpoint: error.paypalRequest?.endpoint || null,
      requestMethod: error.paypalRequest?.method || null,
      details: Array.isArray(error.details?.details)
        ? error.details.details.map((detail) => Object.fromEntries(
            ["field", "location", "issue"].flatMap((key) =>
              detail[key] === undefined ? [] : [[key, detail[key]]],
            ),
          ))
        : [],
    });
    return res.status(error.statusCode && error.statusCode < 500 ? error.statusCode : error.statusCode || 502).json({
      error: getProviderErrorMessage(error, "paypal"),
    });
  }
}

function getCapturedPayPalCard(capture) {
  const card =
    capture.payment_source?.card ||
    capture.purchase_units?.[0]?.payments?.captures?.[0]?.payment_source?.card;
  const vault = card?.attributes?.vault;
  const customerId = vault?.customer?.id || card?.attributes?.customer?.id || null;
  const expiry = String(card?.expiry || "");
  const expiryMatch = /^(\d{4})-(\d{2})$/.exec(expiry);
  const lastDigits = String(card?.last_digits || card?.["last-digits"] || "");

  return {
    vault,
    customerId,
    brand: String(card?.brand || ""),
    lastDigits: /^\d{4}$/.test(lastDigits) ? lastDigits : null,
    expiryMonth: expiryMatch ? Number(expiryMatch[2]) : null,
    expiryYear: expiryMatch ? Number(expiryMatch[1]) : null,
  };
}

function stripPayPalVaultTokens(value) {
  if (Array.isArray(value)) return value.map(stripPayPalVaultTokens);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (key === "id" && value.type === "PAYMENT_METHOD_TOKEN") return [];
      if (key === "vault_id") return [];
      if (key === "vault" && child && typeof child === "object") {
        const { id, ...vaultMetadata } = child as Record<string, unknown>;
        return [[key, stripPayPalVaultTokens(vaultMetadata)]];
      }
      return [[key, stripPayPalVaultTokens(child)]];
    }),
  );
}

async function getSavedPayPalCards(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const methods = await sequelize.query(
      `SELECT "BuyerPayPalVaultMethodId" AS "id", "CardBrand" AS "brand",
              "LastDigits" AS "lastDigits", "ExpiryMonth" AS "expiryMonth",
              "ExpiryYear" AS "expiryYear", "IsDefault" AS "isDefault"
       FROM "BuyerPayPalVaultMethods"
       WHERE "UserId" = :userId
       ORDER BY "CreatedAt" DESC`,
      { replacements: { userId: user.UserId }, type: QueryTypes.SELECT },
    );
    return res.json({ cards: methods });
  } catch (error) {
    console.error("Saved PayPal cards could not be loaded.", error);
    return res.status(500).json({ error: "Saved cards could not be loaded." });
  }
}

async function createSavedCardSetupToken(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const providerStatus = getPayPalConfigurationStatus();
  if (!providerStatus.advancedCardPaymentsEnabled) {
    return res.status(503).json({ error: providerStatus.message });
  }

  try {
    const setupToken = await createPayPalVaultSetupToken();
    if (!setupToken?.id) throw new Error("PayPal did not return a setup token.");
    const setupState = jwt.sign(
      { sub: String(user.UserId), setupTokenId: setupToken.id, purpose: "buyer-card-setup" },
      jwtSecret,
      { expiresIn: "15m" },
    );
    return res.json({ setupTokenId: setupToken.id, setupState });
  } catch (error) {
    console.error("PayPal saved-card setup could not be started.", error.message, error.statusCode);
    const status = error.statusCode === 503 ? 503 : error.statusCode && error.statusCode < 500 ? 400 : 502;
    return res.status(status).json({
      error: status === 400 ? error.message : "PayPal could not start card setup. Please try again.",
    });
  }
}

async function confirmSavedCardSetup(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const setupTokenId = typeof req.body?.vaultSetupToken === "string" ? req.body.vaultSetupToken.trim() : "";
  const setupState = typeof req.body?.setupState === "string" ? req.body.setupState : "";
  if (!setupTokenId || setupTokenId.length > 255 || !setupState || setupState.length > 2048) {
    return res.status(400).json({ error: "The PayPal card setup session is invalid. Start again." });
  }

  let claims;
  try {
    claims = jwt.verify(setupState, jwtSecret);
  } catch {
    return res.status(400).json({ error: "The PayPal card setup session expired. Start again." });
  }
  if (
    typeof claims !== "object" ||
    claims.purpose !== "buyer-card-setup" ||
    String(claims.sub) !== String(user.UserId) ||
    claims.setupTokenId !== setupTokenId
  ) {
    return res.status(403).json({ error: "This PayPal card setup session does not belong to your account." });
  }

  let createdVaultId = "";
  let tokenStored = false;
  let duplicateVaultToken = false;
  try {
    const paymentToken = await createPayPalVaultPaymentToken(setupTokenId);
    createdVaultId = typeof paymentToken?.id === "string" ? paymentToken.id : "";
    if (!createdVaultId) throw new Error("PayPal did not return a saved payment token.");

    const card = paymentToken.payment_source?.card || {};
    const expiry = /^(\d{4})-(\d{2})$/.exec(String(card.expiry || ""));
    const expiryYear = expiry ? Number(expiry[1]) : null;
    const expiryMonth = expiry ? Number(expiry[2]) : null;
    const lastDigits = /^\d{4}$/.test(String(card.last_digits || "")) ? String(card.last_digits) : null;
    const brand = String(card.brand || "").slice(0, 50) || null;
    const customerId = String(paymentToken.customer?.id || "").slice(0, 255) || null;
    const { encryptedToken, fingerprint } = encryptPayPalVaultToken(createdVaultId);
    const saveResult = await sequelize.transaction(async (transaction) => {
      const [lockedUser] = await sequelize.query(
        `SELECT "UserId" FROM "UserAccounts" WHERE "UserId" = :userId FOR UPDATE`,
        { replacements: { userId: user.UserId }, type: QueryTypes.SELECT, transaction },
      );
      if (!lockedUser) throw new Error("User account is unavailable.");

      const hasCardIdentity = Boolean(brand && lastDigits && expiryMonth && expiryYear);
      const [existing] = await sequelize.query(
        `SELECT "UserId" AS "userId", "BuyerPayPalVaultMethodId" AS "id",
                "CardBrand" AS "brand", "LastDigits" AS "lastDigits",
                "ExpiryMonth" AS "expiryMonth", "ExpiryYear" AS "expiryYear",
                "IsDefault" AS "isDefault", "PayPalVaultTokenFingerprint" AS "fingerprint"
         FROM "BuyerPayPalVaultMethods"
         WHERE "PayPalVaultTokenFingerprint" = :fingerprint
            OR (
              :hasCardIdentity = TRUE AND "UserId" = :userId
              AND LOWER(COALESCE("CardBrand", '')) = LOWER(:brand)
              AND "LastDigits" = :lastDigits
              AND "ExpiryMonth" = :expiryMonth
              AND "ExpiryYear" = :expiryYear
            )
         ORDER BY ("PayPalVaultTokenFingerprint" = :fingerprint) DESC, "CreatedAt" DESC
         LIMIT 1`,
        {
          replacements: { userId: user.UserId, fingerprint, hasCardIdentity, brand: brand || "", lastDigits, expiryMonth, expiryYear },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      if (existing) {
        return {
          card: existing,
          isDuplicate: true,
          isSameVaultToken: existing.fingerprint === fingerprint,
        };
      }

      const [inserted] = await sequelize.query(
        `INSERT INTO "BuyerPayPalVaultMethods"
          ("UserId", "PayPalVaultTokenEncrypted", "PayPalVaultTokenFingerprint", "PayPalCustomerId",
           "CardBrand", "LastDigits", "ExpiryMonth", "ExpiryYear", "IsDefault")
         VALUES
          (:userId, :encryptedToken, :fingerprint, :customerId, :brand, :lastDigits, :expiryMonth, :expiryYear,
           NOT EXISTS (
             SELECT 1 FROM "BuyerPayPalVaultMethods"
             WHERE "UserId" = :userId AND "IsDefault" = TRUE
           ))
         ON CONFLICT ("PayPalVaultTokenFingerprint") DO NOTHING
         RETURNING "BuyerPayPalVaultMethodId" AS "id", "CardBrand" AS "brand",
                   "LastDigits" AS "lastDigits", "ExpiryMonth" AS "expiryMonth",
                   "ExpiryYear" AS "expiryYear", "IsDefault" AS "isDefault"`,
        {
          replacements: { userId: user.UserId, encryptedToken, fingerprint, customerId, brand, lastDigits, expiryMonth, expiryYear },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      if (inserted) return { card: { ...inserted, userId: user.UserId }, isDuplicate: false, isSameVaultToken: false };

      const [duplicate] = await sequelize.query(
        `SELECT "UserId" AS "userId", "BuyerPayPalVaultMethodId" AS "id",
                "CardBrand" AS "brand", "LastDigits" AS "lastDigits",
                "ExpiryMonth" AS "expiryMonth", "ExpiryYear" AS "expiryYear",
                "IsDefault" AS "isDefault", "PayPalVaultTokenFingerprint" AS "fingerprint"
         FROM "BuyerPayPalVaultMethods"
         WHERE "PayPalVaultTokenFingerprint" = :fingerprint`,
        { replacements: { fingerprint }, type: QueryTypes.SELECT, transaction },
      );
      return { card: duplicate, isDuplicate: Boolean(duplicate), isSameVaultToken: Boolean(duplicate) };
    });

    const saved = saveResult?.card;
    if (!saved) throw new Error("The card could not be added to your account.");
    if (String(saved.userId) !== String(user.UserId)) {
      duplicateVaultToken = true;
      return res.status(409).json({ error: "This payment method is already linked to another account." });
    }
    if (saveResult.isDuplicate && !saveResult.isSameVaultToken) {
      try {
        await deletePayPalVaultToken(createdVaultId);
      } catch (revokeError) {
        console.error("Duplicate PayPal card token could not be revoked.", revokeError.message, revokeError.statusCode);
      }
    }
    duplicateVaultToken = saveResult.isDuplicate;
    tokenStored = true;
    return res.json({
      card: {
        id: Number(saved.id),
        brand: saved.brand || null,
        lastDigits: saved.lastDigits || null,
        expiryMonth: saved.expiryMonth ? Number(saved.expiryMonth) : null,
        expiryYear: saved.expiryYear ? Number(saved.expiryYear) : null,
        isDefault: Boolean(saved.isDefault),
      },
      alreadyExists: saveResult.isDuplicate,
    });
  } catch (error) {
    if (createdVaultId && !tokenStored && !duplicateVaultToken) {
      try {
        await deletePayPalVaultToken(createdVaultId);
      } catch (cleanupError) {
        console.error("Unstored PayPal card token could not be removed.", cleanupError.message);
      }
    }
    console.error("PayPal saved card could not be added.", error.message, error.statusCode);
    const status = error.statusCode === 503 ? 503 : error.statusCode && error.statusCode < 500 ? 400 : 502;
    return res.status(status).json({
      error: status === 400 ? error.message : "PayPal could not save this card. Please try again.",
    });
  }
}

async function setDefaultPayPalCard(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const savedCardId = Number(req.params.cardId);
  if (!Number.isSafeInteger(savedCardId) || savedCardId <= 0) {
    return res.status(400).json({ error: "A valid saved card ID is required." });
  }

  try {
    const [card] = await sequelize.query(
      `SELECT "BuyerPayPalVaultMethodId", "ExpiryMonth", "ExpiryYear"
       FROM "BuyerPayPalVaultMethods"
       WHERE "BuyerPayPalVaultMethodId" = :savedCardId AND "UserId" = :userId`,
      { replacements: { savedCardId, userId: user.UserId }, type: QueryTypes.SELECT },
    );
    if (!card) return res.status(404).json({ error: "Saved card not found." });
    if (card.ExpiryMonth && card.ExpiryYear) {
      const expiry = new Date(Number(card.ExpiryYear), Number(card.ExpiryMonth), 0, 23, 59, 59, 999);
      if (expiry.getTime() <= Date.now()) {
        return res.status(409).json({ error: "An expired card cannot be set as the default." });
      }
    }

    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `UPDATE "BuyerPayPalVaultMethods" SET "IsDefault" = FALSE
         WHERE "UserId" = :userId AND "IsDefault" = TRUE`,
        { replacements: { userId: user.UserId }, transaction },
      );
      await sequelize.query(
        `UPDATE "BuyerPayPalVaultMethods" SET "IsDefault" = TRUE
         WHERE "BuyerPayPalVaultMethodId" = :savedCardId AND "UserId" = :userId`,
        { replacements: { savedCardId, userId: user.UserId }, transaction },
      );
    });

    return res.json({ success: true, defaultCardId: savedCardId });
  } catch (error) {
    console.error("Default PayPal card could not be updated.", error);
    return res.status(500).json({ error: "Default card could not be updated." });
  }
}

async function deleteSavedPayPalCard(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const savedCardId = Number(req.params.cardId);
  if (!Number.isSafeInteger(savedCardId) || savedCardId <= 0) {
    return res.status(400).json({ error: "A valid saved card ID is required." });
  }

  try {
    const [card] = await sequelize.query(
      `SELECT "PayPalVaultTokenEncrypted", "IsDefault"
       FROM "BuyerPayPalVaultMethods"
       WHERE "BuyerPayPalVaultMethodId" = :savedCardId AND "UserId" = :userId`,
      { replacements: { savedCardId, userId: user.UserId }, type: QueryTypes.SELECT },
    );
    if (!card) return res.status(404).json({ error: "Saved card not found." });

    let vaultId;
    try {
      vaultId = decryptPayPalVaultToken(card.PayPalVaultTokenEncrypted);
    } catch (decryptError) {
      console.error("Saved PayPal card token could not be decrypted for removal.", decryptError);
      return res.status(500).json({ error: "Saved card could not be removed. Please try again." });
    }

    try {
      await deletePayPalVaultToken(vaultId);
    } catch (paypalError) {
      if (paypalError.statusCode !== 404) throw paypalError;
    }

    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `DELETE FROM "BuyerPayPalVaultMethods"
         WHERE "BuyerPayPalVaultMethodId" = :savedCardId AND "UserId" = :userId`,
        { replacements: { savedCardId, userId: user.UserId }, transaction },
      );
      if (card.IsDefault) {
        await sequelize.query(
          `UPDATE "BuyerPayPalVaultMethods"
           SET "IsDefault" = TRUE
           WHERE "BuyerPayPalVaultMethodId" = (
             SELECT "BuyerPayPalVaultMethodId"
             FROM "BuyerPayPalVaultMethods"
             WHERE "UserId" = :userId
             ORDER BY "CreatedAt" DESC, "BuyerPayPalVaultMethodId" DESC
             LIMIT 1
           )`,
          { replacements: { userId: user.UserId }, transaction },
        );
      }
    });

    const [fallbackCard] = await sequelize.query(
      `SELECT "BuyerPayPalVaultMethodId" AS "id"
       FROM "BuyerPayPalVaultMethods"
       WHERE "UserId" = :userId AND "IsDefault" = TRUE
       LIMIT 1`,
      { replacements: { userId: user.UserId }, type: QueryTypes.SELECT },
    );
    return res.json({ success: true, defaultCardId: fallbackCard?.id || null });
  } catch (error) {
    console.error("Saved PayPal card could not be removed.", {
      statusCode: error.statusCode || null,
      debugId: error.details?.debug_id || null,
    });
    return res.status(error.statusCode && error.statusCode < 500 ? error.statusCode : error.statusCode || 502).json({
      error: getProviderErrorMessage(error, "paypal"),
    });
  }
}

async function createABAPayWayOrder(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const orderId = Number(req.body.orderId);
  const requestedPaymentOption = req.body.paymentOption;
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return res.status(400).json({ error: "A valid orderId is required." });
  if (
    requestedPaymentOption !== undefined &&
    requestedPaymentOption !== "abapay_khqr" &&
    requestedPaymentOption !== "abapay_khqr_deeplink" &&
    requestedPaymentOption !== "cards"
  ) {
    return res.status(400).json({ error: "Choose a supported ABA PayWay payment method." });
  }
  const paymentOption = requestedPaymentOption || "abapay_khqr_deeplink";

  try {
    const [order] = await sequelize.query(
      `SELECT "OrderId", "OrderNumber", "TotalAmount", "Currency", "Status", "CreatedAt"
       FROM "Orders" WHERE "OrderId" = :orderId AND "UserId" = :userId`,
      { replacements: { orderId, userId: user.UserId }, type: QueryTypes.SELECT },
    );
    if (!order) return res.status(404).json({ error: "Order not found." });
    if (await orderContainsProductsFromUserStore(orderId, user.UserId)) {
      return res.status(403).json({ error: "You cannot purchase products from your own store." });
    }
    if (await orderHasOtherSuccessfulPurchase(orderId, user.UserId)) {
      return res.status(409).json({ error: "A product in this order has already been purchased. This order cannot be paid again." });
    }
    if (Date.now() - new Date(order.CreatedAt).getTime() >= ORDER_PAYMENT_WINDOW_MS) {
      return res.status(410).json({ error: "The 24-hour payment window for this order has expired. Return to your cart to start a new order." });
    }
    if (!["pending", "failed"].includes(order.Status)) return res.status(409).json({ error: "This order is not available for payment." });

    const [existingPayment] = await sequelize.query(
      `SELECT "PaymentId", "TransactionId", "Status", "Amount", "Currency", "CreatedAt", "ProviderResponse"
       FROM "Payments" WHERE "OrderId" = :orderId AND "PaymentMethod" IN ('abayapayway', 'abapayway', 'payway', 'aba')
       ORDER BY "CreatedAt" DESC LIMIT 1`,
      { replacements: { orderId }, type: QueryTypes.SELECT },
    );
    if (existingPayment?.Status === "paid") return res.status(409).json({ error: "This order has already been paid." });
    if (existingPayment?.TransactionId && existingPayment.Status === "pending") {
      const response = existingPayment.ProviderResponse || {};
      const existingPaymentOption = response.paymentOption || "abapay_khqr_deeplink";
      if (existingPaymentOption !== paymentOption) {
        return res.status(409).json({ error: "A different ABA PayWay payment is still pending. Complete it or wait for it to expire before changing methods." });
      }
      const expiresAt = getABAPayWayPaymentExpiry(existingPayment);
      if (Date.parse(expiresAt) <= Date.now()) {
        const status = await refreshABAPayWayPaymentStatus(existingPayment);
        if (status === "paid") return res.status(409).json({ error: "This order has already been paid." });
        if (status === "pending") {
          return res.status(409).json({ error: "PayWay has not confirmed that the previous payment expired. Try again shortly." });
        }
      } else {
        return res.status(200).json({
          paymentProvider: "abayapayway",
          paymentOption: existingPaymentOption,
          tran_id: existingPayment.TransactionId,
          paymentReference: existingPayment.TransactionId,
          lifetimeMinutes: Number(response.lifetimeMinutes) || 30 * 24 * 60,
          expiresAt,
          qrString: response.qrString || null,
          qrImage: response.qrImage || null,
          deeplink: response.deeplink || null,
          checkoutQrUrl: response.checkoutQrUrl || null,
          formUrl: response.formUrl || null,
          fields: response.fields || null,
        });
      }
    }

    const paymentReference = `${String(order.OrderId).slice(-5)}${Date.now().toString().slice(-13)}`;
    const orderItems = await sequelize.query(
      `SELECT "ProductName", "Quantity", "UnitPrice"
       FROM "OrderItems" WHERE "OrderId" = :orderId ORDER BY "OrderItemId"`,
      { replacements: { orderId }, type: QueryTypes.SELECT },
    );
    const backendBaseUrl = String(process.env.BACKEND_URL || "http://localhost:5000").replace(/\/+$/, "");
    const frontendBaseUrl = String(process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
    const returnUrl = new URL(
      process.env.PAYWAY_NOTIFY_URL ||
        process.env.PAYWAY_RETURN_URL ||
        `${backendBaseUrl}/api/payments/payway/capture`,
    );
    returnUrl.searchParams.set("reference", paymentReference);
    const continueSuccessUrl = new URL(`${frontendBaseUrl}/cart/payment`);
    continueSuccessUrl.searchParams.set("payway_reference", paymentReference);
    continueSuccessUrl.searchParams.set("payway_option", paymentOption);
    const cancelUrl = new URL(`${frontendBaseUrl}/cart/payment`);
    cancelUrl.searchParams.set("payway_reference", paymentReference);
    cancelUrl.searchParams.set("payway_option", paymentOption);
    cancelUrl.searchParams.set("payway_cancelled", "1");
    const paymentRequest = createABAPayWayPayment({
      amount: order.TotalAmount,
      currency: order.Currency,
      referenceId: paymentReference,
      paymentOption,
      description: `Marketplace order ${order.OrderNumber}`,
      returnUrl: returnUrl.toString(),
      cancelUrl: process.env.PAYWAY_CANCEL_URL || cancelUrl.toString(),
      continueSuccessUrl: continueSuccessUrl.toString(),
      buyerEmail: user.Email || user.email || null,
      items: orderItems.map((item) => ({
        name: item.ProductName,
        quantity: Number(item.Quantity),
        price: Number(item.UnitPrice),
      })),
    });
    const checkout = paymentOption !== "abapay_khqr_deeplink"
      ? {
          tran_id: paymentRequest.referenceId,
          paymentReference: paymentRequest.referenceId,
          paymentOption: paymentRequest.paymentOption,
          lifetimeMinutes: paymentRequest.lifetimeMinutes,
          expiresAt: paymentRequest.expiresAt,
          formUrl: paymentRequest.formUrl,
          fields: paymentRequest.fields,
        }
      : await submitABAPayWayPayment(paymentRequest);

    await sequelize.query(
      `INSERT INTO "Payments" ("OrderId", "PaymentMethod", "TransactionId", "Amount", "Currency", "Status", "ProviderResponse")
       VALUES (:orderId, 'abayapayway', :transactionId, :amount, :currency, 'pending', CAST(:providerResponse AS jsonb))`,
      {
        replacements: {
          orderId,
          transactionId: checkout.paymentReference,
          amount: order.TotalAmount,
          currency: order.Currency,
          providerResponse: JSON.stringify(checkout),
        },
      },
    );

    return res.status(201).json({
      paymentProvider: "abayapayway",
      ...checkout,
    });
  } catch (error) {
    console.error("ABA PayWay order creation failed", {
      statusCode: error.statusCode || null,
      providerCode: error.providerCode || null,
      debugId: error.debugId || null,
    });
    return res.status(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).json({
      error: getProviderErrorMessage(error, "payway"),
    });
  }
}

async function getABAPayWayPaymentStatus(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const paymentReference = String(req.params.paymentReference || "").trim();
  if (!paymentReference) return res.status(400).json({ error: "A valid payment reference is required." });

  try {
    const [payment] = await sequelize.query(
      `SELECT p."PaymentId", p."Status", p."TransactionId", p."Amount", p."Currency", p."CreatedAt", p."ProviderResponse", o."OrderId"
       FROM "Payments" p JOIN "Orders" o ON o."OrderId" = p."OrderId"
       WHERE p."TransactionId" = :paymentReference
         AND o."UserId" = :userId
         AND p."PaymentMethod" IN ('abayapayway', 'abapayway', 'payway', 'aba')`,
      { replacements: { paymentReference, userId: user.UserId }, type: QueryTypes.SELECT },
    );
    if (!payment) return res.status(404).json({ error: "ABA PayWay payment not found." });
    const status = await refreshABAPayWayPaymentStatus(payment);
    return res.json({
      tran_id: payment.TransactionId,
      paymentReference: payment.TransactionId,
      orderId: payment.OrderId,
      status,
      paymentOption: payment.ProviderResponse?.paymentOption || "abapay_khqr_deeplink",
      expiresAt: getABAPayWayPaymentExpiry(payment),
      amount: Number(payment.Amount),
      currency: payment.Currency,
    });
  } catch (error) {
    console.error("ABA PayWay payment status lookup failed", {
      tran_id: paymentReference,
      statusCode: error.statusCode || null,
      providerCode: error.providerCode || null,
    });
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to check ABA PayWay payment status.",
      tran_id: paymentReference,
      paymentReference,
      providerCode: error.providerCode || null,
    });
  }
}

async function refreshABAPayWayPaymentStatus(payment) {
  let providerResult;
  try {
    providerResult = await checkABAPayWayTransaction(payment.TransactionId);
  } catch (error) {
    if (error.providerCode !== "6") throw error;

    const nextStatus = Date.parse(getABAPayWayPaymentExpiry(payment)) <= Date.now() ? "expired" : "pending";
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `UPDATE "Payments"
         SET "Status" = :status,
             "ProviderResponse" = COALESCE("ProviderResponse", '{}'::jsonb) ||
               CAST(:providerResponse AS jsonb)
         WHERE "PaymentId" = :paymentId`,
        {
          replacements: {
            status: nextStatus,
            providerResponse: JSON.stringify({
              statusCheck: {
                providerCode: "6",
                message: "Transaction not found",
                checkedAt: new Date().toISOString(),
              },
            }),
            paymentId: payment.PaymentId,
          },
          transaction,
        },
      );
    });
    return nextStatus;
  }

  let nextStatus = "pending";
  const providerPaymentStatus = String(providerResult.paymentStatus || "").trim().toUpperCase();
  const providerPaymentStatusCode = String(providerResult.paymentStatusCode || "").trim();
  if (
    (providerPaymentStatusCode !== "" && Number(providerPaymentStatusCode) === 0) ||
    ["APPROVED", "SUCCESS", "SUCCEEDED", "PAID", "COMPLETED"].includes(providerPaymentStatus)
  ) {
    const expectedAmount = Number(payment.Amount);
    const providerAmount = providerResult.totalAmount;
    const expectedCurrency = String(payment.Currency || "").toUpperCase();
    if (
      !Number.isFinite(expectedAmount) ||
      !Number.isFinite(providerAmount) ||
      Math.abs(expectedAmount - providerAmount) >= 0.01 ||
      (providerResult.paymentCurrency && providerResult.paymentCurrency !== expectedCurrency)
    ) {
      const error = new Error("PayWay confirmed a payment, but its amount or currency does not match this order.") as Error & { statusCode?: number };
      error.statusCode = 409;
      throw error;
    }
    nextStatus = "paid";
  } else if (
    providerResult.paymentStatusCode === "3" ||
    ["DECLINED", "FAILED"].includes(providerPaymentStatus)
  ) {
    nextStatus = "failed";
  } else if (providerResult.paymentStatusCode === "4" || providerPaymentStatus === "REFUNDED") {
    nextStatus = "refunded";
  } else if (
    providerResult.paymentStatusCode === "7" ||
    ["CANCELLED", "CANCELED"].includes(providerPaymentStatus)
  ) {
    nextStatus = "cancelled";
  } else if (Date.parse(getABAPayWayPaymentExpiry(payment)) <= Date.now()) {
    nextStatus = "expired";
  }

  let orderCancelled = false;
  await sequelize.transaction(async (transaction) => {
    const [order] = await sequelize.query(
      `SELECT "Status" FROM "Orders" WHERE "OrderId" = :orderId FOR UPDATE`,
      { replacements: { orderId: payment.OrderId }, type: QueryTypes.SELECT, transaction },
    );
    orderCancelled = String(order?.Status || "").toLowerCase() === "cancelled";

    await sequelize.query(
      `UPDATE "Payments"
       SET "Status" = :status,
           "PaidAt" = CASE WHEN :status = 'paid' THEN COALESCE("PaidAt", CURRENT_TIMESTAMP) ELSE "PaidAt" END,
           "ProviderResponse" = COALESCE("ProviderResponse", '{}'::jsonb) ||
             CAST(:providerResponse AS jsonb)
       WHERE "PaymentId" = :paymentId`,
      {
        replacements: {
          status: nextStatus,
          providerResponse: JSON.stringify({
            statusCheck: providerResult,
            checkedAt: new Date().toISOString(),
          }),
          paymentId: payment.PaymentId,
        },
        transaction,
      },
    );

    if (nextStatus === "paid" && !orderCancelled) {
      await finance.recordPaidOrderEarnings({
        paymentId: payment.PaymentId,
        transaction,
        providerFee: null,
      });
      const [updatedOrder] = await sequelize.query(
        `UPDATE "Orders" SET "Status" = 'paid'
         WHERE "OrderId" = :orderId AND "Status" IN ('pending', 'processing', 'failed')
         RETURNING "OrderId"`,
        { replacements: { orderId: payment.OrderId }, type: QueryTypes.SELECT, transaction },
      );
      if (updatedOrder) await notifyOrderPaid(payment.OrderId, transaction);
    } else if (nextStatus === "refunded") {
      await finance.applyPaymentAdjustment({
        paymentId: payment.PaymentId,
        adjustmentType: "refund",
        providerAmount: String(payment.Amount),
        externalReference: `payway-refund:${payment.TransactionId || payment.PaymentId}`,
        reason: "ABA PayWay confirmed a refund.",
        transaction,
      });
      await sequelize.query(
        `UPDATE "Orders" SET "Status" = 'refunded'
         WHERE "OrderId" = :orderId AND "Status" IN ('paid', 'completed', 'partially_refunded')`,
        { replacements: { orderId: payment.OrderId }, transaction },
      );
    }
  });

  if (nextStatus === "paid" && !orderCancelled) await issueOrderLicenses(payment.OrderId);
  if (nextStatus === "refunded") await applyRefundLicensePolicy(payment.OrderId);
  return nextStatus;
}

function getABAPayWayPaymentExpiry(payment) {
  const providerResponse = payment.ProviderResponse || {};
  const savedExpiry = Date.parse(providerResponse.expiresAt || "");
  if (Number.isFinite(savedExpiry)) return new Date(savedExpiry).toISOString();

  const createdAt = new Date(payment.CreatedAt).getTime();
  if (!Number.isFinite(createdAt)) return new Date(0).toISOString();

  const lifetimeMinutes = Number(providerResponse.lifetimeMinutes) || 30 * 24 * 60;
  return new Date(createdAt + lifetimeMinutes * 60_000).toISOString();
}

async function captureABAPayWayOrder(req, res) {
  const paymentReference = String(
    req.body?.reference ||
      req.body?.paymentReference ||
      req.body?.transactionId ||
      req.body?.payWayReference ||
      req.body?.tran_id ||
      req.query?.reference ||
      "",
  ).trim();
  const hasAuthorization = Boolean(req.headers.authorization);
  const user = hasAuthorization ? await requireUser(req, res) : null;
  if (hasAuthorization && !user) return;
  if (!user && !paymentReference) {
    return res.status(401).json({ error: "Authentication required for verification." });
  }
  if (!paymentReference) return res.status(400).json({ error: "A valid payment reference is required." });

  try {
    const [payment] = await sequelize.query(
      `SELECT p."PaymentId", p."OrderId", p."Status", p."TransactionId", p."Amount", p."Currency", p."CreatedAt", p."ProviderResponse", o."UserId"
       FROM "Payments" p JOIN "Orders" o ON o."OrderId" = p."OrderId"
       WHERE p."TransactionId" = :paymentReference AND p."PaymentMethod" IN ('abayapayway', 'abapayway', 'payway', 'aba')`,
      { replacements: { paymentReference }, type: QueryTypes.SELECT },
    );
    if (!payment) return res.status(404).json({ error: "ABA PayWay payment not found." });

    if (user && payment.UserId !== user.UserId) return res.status(403).json({ error: "You do not own this payment." });
    const nextStatus = await refreshABAPayWayPaymentStatus(payment);
    return res.json({ status: nextStatus, tran_id: payment.TransactionId, paymentReference, orderId: payment.OrderId });
  } catch (error) {
    console.error("ABA PayWay capture failed", error);
    return res.status(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).json({
      error: error.statusCode === 503 ? error.message : "Unable to capture ABA PayWay payment.",
    });
  }
}

async function createCheckoutOrder(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  let rawItems = req.body?.items;
  if (!Array.isArray(rawItems) && req.body) {
    rawItems = Array.isArray(req.body.products) ? req.body.products : [{ productId: req.body.productId, quantity: req.body.quantity || 1 }];
  }

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return res.status(400).json({ error: "At least one product is required to create an order." });
  }

  try {
    const normalizedItems = rawItems.reduce((acc, item) => {
      const productId = Number(item?.productId ?? item?.ProductId ?? item?.id ?? item?.productID);
      const quantity = Number(item?.quantity ?? item?.qty ?? item?.Quantity ?? 1);
      const licenseTypeId = item?.licenseTypeId == null || item.licenseTypeId === ""
        ? null
        : Number(item.licenseTypeId);
      if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error("Each cart item must include a valid productId and quantity.");
      }
      if (quantity !== 1) {
        throw new Error("Only one copy of each product can be purchased per order.");
      }
      if (licenseTypeId !== null && (!Number.isSafeInteger(licenseTypeId) || licenseTypeId <= 0)) {
        throw new Error("Each selected license type must be valid.");
      }
      const existing = acc.find((entry) => entry.productId === productId);
      if (existing) {
        throw new Error("A product can only appear once in an order.");
      }
      acc.push({
        productId,
        quantity: Math.floor(quantity),
        licenseTypeId,
        allowRepurchase: item?.allowRepurchase === true,
      });
      return acc;
    }, []);

    const productIds = normalizedItems.map((item) => item.productId);
    const productRows = (await sequelize.query(
      `SELECT p."ProductId", p."ProductName", p."Currency", p."StorefrontId", p."Status",
         cp."UserId" AS "CreatorUserId",
         CASE
           WHEN COALESCE(v."IsFree", FALSE) THEN 0
           WHEN p."DiscountType" = 'percentage'
             THEN GREATEST(COALESCE(v."Price", p."Price") * (1 - p."DiscountAmount" / 100), 0)
           WHEN p."DiscountType" = 'fixed'
             THEN GREATEST(COALESCE(v."Price", p."Price") - p."DiscountAmount", 0)
           ELSE COALESCE(v."Price", p."Price")
         END AS "CurrentPrice",
         v."ProductVersionId" AS "CurrentVersionId",
         v."LicenseTypeId" AS "CurrentLicenseTypeId",
         p."DiscountType", p."DiscountAmount"
       FROM "Products" p
       JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
       JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId" AND cp."IsActive" = TRUE
       LEFT JOIN LATERAL (
         SELECT pv."ProductVersionId", pv."Price", pv."IsFree", pv."LicenseTypeId"
         FROM "ProductVersions" pv
         WHERE pv."ProductId" = p."ProductId"
         ORDER BY pv."IsCurrent" DESC, pv."CreatedAt" DESC, pv."ProductVersionId" DESC
         LIMIT 1
       ) v ON TRUE
       WHERE p."ProductId" IN (:productIds)
         AND p."Status" = 'published'
         AND s."IsPublished" = TRUE
         AND s."IsActive" = TRUE
       ORDER BY p."ProductId" ASC`,
      {
        replacements: { productIds },
        type: QueryTypes.SELECT,
      },
    )) as ProductPricingRow[];
    const products = productRows;
    if (!products.length || products.length !== productIds.length) {
      return res.status(404).json({ error: "One or more products in the cart could not be found." });
    }
    if (products.some((product) => Number(product.CreatorUserId) === Number(user.UserId))) {
      return res.status(403).json({ error: "You cannot purchase products from your own store." });
    }

    const productMap = new Map((products).map((product) => [Number(product.ProductId), product]));
    const lineItems = await Promise.all(normalizedItems.map(async (item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new Error(`Product ${item.productId} is not available for purchase.`);
      }
      let selectedLicense = null;
      if (product.CurrentVersionId) {
        const licenseOptions = await sequelize.query(
          `SELECT pvl."LicenseTypeId", pvl."Price", pvl."LicenseTerms",
                  pvl."RequiresKey", lt."UsageRights", lt."Restrictions"
           FROM "ProductVersionLicenses" pvl
           JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = pvl."LicenseTypeId"
           WHERE pvl."ProductVersionId" = :versionId
             AND lt."IsActive" = TRUE
           ORDER BY pvl."LicenseTypeId"`,
          { replacements: { versionId: product.CurrentVersionId }, type: QueryTypes.SELECT },
        );
        if (item.licenseTypeId !== null) {
          selectedLicense = licenseOptions.find((option) => Number(option.LicenseTypeId) === item.licenseTypeId);
          if (!selectedLicense) throw new Error("The selected license is no longer available for this product.");
        } else if (licenseOptions.length) {
          selectedLicense =
            licenseOptions.find((option) => Number(option.LicenseTypeId) === Number(product.CurrentLicenseTypeId)) ||
            licenseOptions[0];
        }
      }
      let unitPrice = Number(product.CurrentPrice || 0);
      if (selectedLicense) {
        const licensePrice = Number(selectedLicense.Price || 0);
        if (licensePrice <= 0) {
          unitPrice = Number(product.CurrentPrice || 0);
        } else if (product.DiscountType === "percentage") {
          unitPrice = Math.max(licensePrice * (1 - Number(product.DiscountAmount || 0) / 100), 0);
        } else if (product.DiscountType === "fixed") {
          unitPrice = Math.max(licensePrice - Number(product.DiscountAmount || 0), 0);
        } else {
          unitPrice = licensePrice;
        }
      }
      return {
        ...item,
        productName: product.ProductName,
        storefrontId: product.StorefrontId,
        currency: product.Currency || "USD",
        unitPrice,
        productVersionId: product.CurrentVersionId,
        licenseTypeId: selectedLicense ? Number(selectedLicense.LicenseTypeId) : null,
        licenseTermsSnapshot: selectedLicense
          ? [selectedLicense.LicenseTerms, selectedLicense.UsageRights, selectedLicense.Restrictions].filter(Boolean).join("\n\n")
          : "",
        totalAmount: unitPrice * item.quantity,
      };
    }));

    const currencies = new Set(lineItems.map((item) => String(item.currency).toUpperCase()));
    if (currencies.size !== 1) {
      return res.status(400).json({ error: "Products with different currencies cannot be checked out together." });
    }

    const subtotal = lineItems.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
    const amountNumber = Number(subtotal || 0);
    const requestedProductIds = normalizedItems.map((item) => item.productId).sort((a, b) => a - b);
    const checkoutResult = await sequelize.transaction(async (transaction) => {
      for (const productId of requestedProductIds) {
        await sequelize.query(
          `SELECT pg_advisory_xact_lock(:userId, :productId)`,
          { replacements: { userId: user.UserId, productId }, type: QueryTypes.SELECT, transaction },
        );
      }

      const existingOrders = await sequelize.query(
        `SELECT o."OrderId", o."OrderNumber", o."TotalAmount", o."Currency", o."Status", o."CreatedAt",
                ARRAY_AGG(DISTINCT oi."ProductId") AS "productIds",
                JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
                  'productId', oi."ProductId", 'quantity', oi."Quantity",
                  'licenseTypeId', oi."LicenseTypeId"
                )) AS items,
                BOOL_OR(p."Status" IN ('pending', 'authorized')) AS "hasOpenPayment"
         FROM "Orders" o
         JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
         LEFT JOIN "Payments" p ON p."OrderId" = o."OrderId"
         WHERE o."UserId" = :userId AND oi."ProductId" IN (:productIds)
         GROUP BY o."OrderId"
         ORDER BY o."CreatedAt" DESC, o."OrderId" DESC`,
        {
          replacements: { userId: user.UserId, productIds: requestedProductIds },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const requestedIds = new Set(requestedProductIds);
      const coversRequestedProducts = (order) =>
        [...requestedIds].every((productId) => order.productIds.some((existingId) => Number(existingId) === productId));
      const requestItems = lineItems
        .map((item) => `${item.productId}:${item.quantity}:${item.licenseTypeId ?? ""}`)
        .sort();
      const hasSameItems = (order) => {
        const orderItems = order.items
          .map((item) => `${Number(item.productId)}:${Number(item.quantity)}:${item.licenseTypeId ?? ""}`)
          .sort();
        return requestItems.length === orderItems.length &&
          requestItems.every((item, index) => item === orderItems[index]);
      };
      const repurchaseProductIds = new Set(
        normalizedItems
          .filter((item) => item.allowRepurchase)
          .map((item) => item.productId),
      );
      const policyOrders = existingOrders.filter((order) => {
        const status = String(order.Status).toLowerCase();
        const isSettled = ["paid", "completed"].includes(status);
        return !isSettled ||
          order.productIds.some((productId) => !repurchaseProductIds.has(Number(productId)));
      });
      const successfulOrders = policyOrders.filter((order) => ["paid", "completed"].includes(String(order.Status).toLowerCase()));
      const successfulOrder = successfulOrders.find(coversRequestedProducts);
      if (successfulOrder) {
        return { order: successfulOrder, alreadyPurchased: true, reusedOrder: true };
      }
      if (successfulOrders.length) {
        return { conflictOrder: successfulOrders[0], conflictReason: "A product in your cart has already been purchased." };
      }

      const now = Date.now();
      const reusableOrders = policyOrders.filter((order) => {
        const status = String(order.Status).toLowerCase();
        return ["pending", "failed"].includes(status) &&
          now - new Date(order.CreatedAt).getTime() < ORDER_PAYMENT_WINDOW_MS;
      });
      const reusableOrder = reusableOrders.find((order) => coversRequestedProducts(order) && hasSameItems(order));
      if (reusableOrder) {
        for (const item of lineItems.filter((lineItem) => lineItem.allowRepurchase)) {
          await sequelize.query(
            `UPDATE "OrderItems"
             SET "AllowRepurchase" = TRUE
             WHERE "OrderId" = :orderId AND "ProductId" = :productId`,
            {
              replacements: { orderId: reusableOrder.OrderId, productId: item.productId },
              transaction,
            },
          );
        }
        return { order: reusableOrder, alreadyPurchased: false, reusedOrder: true };
      }
      if (reusableOrders.length) {
        return {
          conflictOrder: reusableOrders[0],
          conflictReason: "A product in your cart is already in another unpaid order. Finish that order or remove the product before checking out.",
        };
      }

      const expiredOrdersWithOpenPayments = policyOrders.filter((order) => {
        const status = String(order.Status).toLowerCase();
        return ["pending", "failed"].includes(status) &&
          now - new Date(order.CreatedAt).getTime() >= ORDER_PAYMENT_WINDOW_MS &&
          order.hasOpenPayment;
      });
      if (expiredOrdersWithOpenPayments.length) {
        return {
          conflictOrder: expiredOrdersWithOpenPayments[0],
          conflictReason: "The 24-hour payment window has ended, but the provider has not confirmed the previous payment attempt is closed. Check payment history before trying again.",
        };
      }

      for (const order of policyOrders) {
        if (String(order.Status).toLowerCase() === "pending" &&
            now - new Date(order.CreatedAt).getTime() >= ORDER_PAYMENT_WINDOW_MS) {
          await sequelize.query(
            `UPDATE "Orders" SET "Status" = 'failed'
             WHERE "OrderId" = :orderId AND "Status" = 'pending'`,
            { replacements: { orderId: order.OrderId }, transaction },
          );
        }
      }
      const blockedOrder = policyOrders.find((order) =>
        !["pending", "failed", "cancelled"].includes(String(order.Status).toLowerCase()),
      );
      if (blockedOrder) {
        return {
          conflictOrder: blockedOrder,
          conflictReason: "A product in your cart is already associated with an order that cannot be checked out again.",
        };
      }

      const orderNumber = `ORD-${Date.now()}-${user.UserId}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const [createdOrder] = await sequelize.query(
        `INSERT INTO "Orders" ("UserId", "OrderNumber", "Subtotal", "DiscountAmount", "TaxAmount", "TotalAmount", "Currency", "Status")
         VALUES (:userId, :orderNumber, :subtotal, 0, 0, :totalAmount, :currency, :status)
         RETURNING "OrderId", "OrderNumber", "TotalAmount", "Currency", "Status", "CreatedAt"`,
        {
          replacements: {
            userId: user.UserId,
            orderNumber,
            subtotal: amountNumber,
            totalAmount: amountNumber,
            currency: lineItems[0].currency,
            status: amountNumber > 0 ? "pending" : "completed",
          },
          type: QueryTypes.SELECT,
          transaction,
        },
      );

      for (const item of lineItems) {
        await sequelize.query(
          `INSERT INTO "OrderItems"
             ("OrderId", "ProductId", "StorefrontId", "ProductName", "Quantity",
              "UnitPrice", "DiscountAmount", "TotalAmount", "LicenseTypeId",
              "ProductVersionId", "LicenseTermsSnapshot", "AllowRepurchase")
           VALUES
             (:orderId, :productId, :storefrontId, :productName, :quantity,
              :unitPrice, 0, :totalAmount, :licenseTypeId, :productVersionId, :licenseTermsSnapshot,
              :allowRepurchase)`,
          {
            replacements: {
              orderId: createdOrder.OrderId,
              productId: item.productId,
              storefrontId: item.storefrontId,
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalAmount: item.totalAmount,
              licenseTypeId: item.licenseTypeId,
              productVersionId: item.productVersionId,
              licenseTermsSnapshot: item.licenseTermsSnapshot,
              allowRepurchase: item.allowRepurchase,
            },
            transaction,
          },
        );
      }

      if (amountNumber === 0) {
        await sequelize.query(
          `INSERT INTO "Payments" ("OrderId", "PaymentMethod", "TransactionId", "Amount", "Currency", "Status", "PaidAt", "ProviderResponse")
           VALUES (:orderId, 'free', :transactionId, 0, :currency, 'paid', CURRENT_TIMESTAMP, CAST(:providerResponse AS jsonb))`,
          {
            replacements: {
              orderId: createdOrder.OrderId,
              transactionId: `FREE-${createdOrder.OrderId}`,
              currency: lineItems[0].currency,
              providerResponse: JSON.stringify({ method: "free", status: "paid", purchase: "no_payment_required" }),
            },
            transaction,
          },
        );
      }
      return { order: createdOrder, alreadyPurchased: false, reusedOrder: false };
    });

    if (checkoutResult.conflictOrder) {
      const conflictOrder = checkoutResult.conflictOrder;
      return res.status(409).json({
        error: checkoutResult.conflictReason,
        existingOrder: {
          orderId: conflictOrder.OrderId,
          orderNumber: conflictOrder.OrderNumber,
          status: conflictOrder.Status,
          paymentDueAt: new Date(new Date(conflictOrder.CreatedAt).getTime() + ORDER_PAYMENT_WINDOW_MS).toISOString(),
        },
      });
    }

    const order = checkoutResult.order;
    if (checkoutResult.alreadyPurchased || amountNumber === 0) await issueOrderLicenses(order.OrderId);
    const status = checkoutResult.alreadyPurchased
      ? "completed"
      : String(order.Status).toLowerCase() === "completed" && Number(order.TotalAmount) > 0
        ? "completed"
        : String(order.Status).toLowerCase();
    return res.status(checkoutResult.reusedOrder ? 200 : 201).json({
      orderId: order.OrderId,
      orderNumber: order.OrderNumber,
      status,
      totalAmount: Number(order.TotalAmount || amountNumber),
      paymentMethod: checkoutResult.alreadyPurchased
        ? "already_purchased"
        : Number(order.TotalAmount || amountNumber) > 0
          ? "pending"
          : "free",
      currency: order.Currency || lineItems[0]?.currency || "USD",
      paymentDueAt: new Date(new Date(order.CreatedAt).getTime() + ORDER_PAYMENT_WINDOW_MS).toISOString(),
      reusedOrder: checkoutResult.reusedOrder,
      alreadyPurchased: checkoutResult.alreadyPurchased,
    });
  } catch (error) {
    console.error("Checkout order creation failed", error);
    const message = error?.message || "Unable to create the checkout order.";
    return res.status(400).json({ error: message });
  }
}

async function getPurchaseEligibility(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const productId = Number(req.params.productId);
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "A valid productId is required." });
  }

  try {
    const [product] = await sequelize.query(
      `SELECT cp."UserId" AS "CreatorUserId",
              EXISTS (
                SELECT 1
                FROM "Orders" o
                JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
                WHERE o."UserId" = :userId
                  AND oi."ProductId" = p."ProductId"
                  AND o."Status" IN ('paid', 'completed')
              ) AS "alreadyPurchased"
       FROM "Products" p
       JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
       JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
       WHERE p."ProductId" = :productId
         AND p."Status" = 'published'
         AND s."IsPublished" = TRUE
         AND s."IsActive" = TRUE
         AND cp."IsActive" = TRUE
       LIMIT 1`,
      { replacements: { productId, userId: user.UserId }, type: QueryTypes.SELECT },
    );
    if (!product) return res.status(404).json({ error: "Product not found." });

    const canPurchase = Number(product.CreatorUserId) !== Number(user.UserId);
    return res.json({
      canPurchase,
      alreadyPurchased: Boolean(product.alreadyPurchased),
    });
  } catch (error) {
    console.error("Purchase eligibility check failed", error);
    return res.status(500).json({ error: "Unable to verify purchase eligibility." });
  }
}

async function createFreeProductOrder(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const productId = Number(req.body.productId || req.body.ProductId || req.body.id);
  if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: "A valid productId is required." });

  try {
    const [product] = await sequelize.query(
      `SELECT p."ProductId", p."ProductName", p."Price", p."Currency", p."StorefrontId", p."Status",
              cp."UserId" AS "CreatorUserId",
              v."ProductVersionId", v."Price" AS "VersionPrice", v."IsFree",
              v."LicenseTypeId" AS "DefaultLicenseTypeId"
       FROM "Products" p
       JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
       JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
       LEFT JOIN LATERAL (
         SELECT pv."ProductVersionId", pv."Price", pv."IsFree", pv."LicenseTypeId"
         FROM "ProductVersions" pv
         WHERE pv."ProductId" = p."ProductId"
         ORDER BY pv."IsCurrent" DESC, pv."CreatedAt" DESC, pv."ProductVersionId" DESC
         LIMIT 1
       ) v ON TRUE
       WHERE p."ProductId" = :productId AND p."Status" = 'published'`,
      { replacements: { productId }, type: QueryTypes.SELECT },
    );
    if (!product) return res.status(404).json({ error: "Free product not found." });
    if (Number(product.CreatorUserId) === Number(user.UserId)) {
      return res.status(403).json({ error: "You cannot purchase products from your own store." });
    }
    if (Number(product.VersionPrice ?? product.Price ?? 0) > 0 && !product.IsFree) {
      return res.status(400).json({ error: "This product is not free." });
    }

    let selectedLicense = null;
    if (product.ProductVersionId) {
      const licenseOptions = await sequelize.query(
        `SELECT pvl."LicenseTypeId", pvl."Price", pvl."LicenseTerms",
                pvl."RequiresKey", lt."UsageRights", lt."Restrictions"
         FROM "ProductVersionLicenses" pvl
         JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = pvl."LicenseTypeId"
         WHERE pvl."ProductVersionId" = :versionId AND lt."IsActive" = TRUE
         ORDER BY pvl."LicenseTypeId"`,
        { replacements: { versionId: product.ProductVersionId }, type: QueryTypes.SELECT },
      );
      selectedLicense =
        licenseOptions.find((option) => Number(option.LicenseTypeId) === Number(product.DefaultLicenseTypeId)) ||
        licenseOptions[0] ||
        null;
      if (selectedLicense && Number(selectedLicense.Price || 0) > 0) {
        return res.status(400).json({ error: "The default license for this product is not free." });
      }
    }

    const existingOrder = await sequelize.query(
      `SELECT o."OrderId", o."OrderNumber", o."Status"
       FROM "Orders" o
       JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
       WHERE o."UserId" = :userId AND oi."ProductId" = :productId AND o."Status" IN ('paid', 'completed', 'processing')
       ORDER BY o."CreatedAt" DESC LIMIT 1`,
      { replacements: { userId: user.UserId, productId }, type: QueryTypes.SELECT },
    );
    if (existingOrder[0]) {
      if (["paid", "completed"].includes(String(existingOrder[0].Status).toLowerCase())) {
        await issueOrderLicenses(existingOrder[0].OrderId);
      }
      return res.status(200).json({
        orderId: existingOrder[0].OrderId,
        orderNumber: existingOrder[0].OrderNumber,
        status: existingOrder[0].Status,
        paymentMethod: "free",
        totalAmount: 0,
      });
    }

    const orderNumber = `FREE-${Date.now()}-${user.UserId}-${productId}`;
    await sequelize.query(
      `INSERT INTO "Orders" ("UserId", "OrderNumber", "Subtotal", "DiscountAmount", "TaxAmount", "TotalAmount", "Currency", "Status")
       VALUES (:userId, :orderNumber, :subtotal, 0, 0, :totalAmount, :currency, 'completed')`,
      {
        replacements: {
          userId: user.UserId,
          orderNumber,
          subtotal: 0,
          totalAmount: 0,
          currency: product.Currency || "USD",
        },
      },
    );

    const [order] = await sequelize.query(
      `SELECT "OrderId", "OrderNumber" FROM "Orders" WHERE "OrderNumber" = :orderNumber AND "UserId" = :userId LIMIT 1`,
      { replacements: { orderNumber, userId: user.UserId }, type: QueryTypes.SELECT },
    );

    await sequelize.query(
      `INSERT INTO "OrderItems"
         ("OrderId", "ProductId", "StorefrontId", "ProductName", "Quantity",
          "UnitPrice", "DiscountAmount", "TotalAmount", "LicenseTypeId",
          "ProductVersionId", "LicenseTermsSnapshot")
       VALUES
         (:orderId, :productId, :storefrontId, :productName, 1, 0, 0, 0,
          :licenseTypeId, :productVersionId, :licenseTermsSnapshot)`,
      {
        replacements: {
          orderId: order.OrderId,
          productId: product.ProductId,
          storefrontId: product.StorefrontId,
          productName: product.ProductName,
          licenseTypeId: selectedLicense?.LicenseTypeId || null,
          productVersionId: product.ProductVersionId || null,
          licenseTermsSnapshot: selectedLicense
            ? [selectedLicense.LicenseTerms, selectedLicense.UsageRights, selectedLicense.Restrictions].filter(Boolean).join("\n\n")
            : "",
        },
      },
    );

    await sequelize.query(
      `INSERT INTO "Payments" ("OrderId", "PaymentMethod", "TransactionId", "Amount", "Currency", "Status", "PaidAt", "ProviderResponse")
       VALUES (:orderId, 'free', :transactionId, 0, :currency, 'paid', CURRENT_TIMESTAMP, CAST(:providerResponse AS jsonb))`,
      {
        replacements: {
          orderId: order.OrderId,
          transactionId: `FREE-${order.OrderId}`,
          currency: product.Currency || "USD",
          providerResponse: JSON.stringify({ method: "free", status: "paid", purchase: "no_payment_required" }),
        },
      },
    );

    await issueOrderLicenses(order.OrderId);
    return res.status(201).json({ orderId: order.OrderId, orderNumber: order.OrderNumber, status: "completed", paymentMethod: "free", totalAmount: 0 });
  } catch (error) {
    console.error("Free product order failed", error);
    return res.status(500).json({ error: "Unable to grant free product access." });
  }
}

async function retryPaymentOrder(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const orderId = Number(req.body.orderId || req.body.OrderId);
  const provider = String(req.body.provider || req.body.PaymentMethod || "paypal").toLowerCase();
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return res.status(400).json({ error: "A valid orderId is required." });

  if (provider === "paypal" || provider === "paypalcheckout") return createPaymentOrder(req, res);
  if (provider === "abayapayway" || provider === "abapayway" || provider === "payway" || provider === "aba") return createABAPayWayOrder(req, res);
  return res.status(400).json({ error: "Unsupported payment provider." });
}

module.exports = {
  createPaymentOrder,
  getPaymentProviderStatus,
  capturePaymentOrder,
  getSavedPayPalCards,
  createSavedCardSetupToken,
  confirmSavedCardSetup,
  setDefaultPayPalCard,
  deleteSavedPayPalCard,
  createABAPayWayOrder,
  getABAPayWayPaymentStatus,
  captureABAPayWayOrder,
  createCheckoutOrder,
  getPurchaseEligibility,
  createFreeProductOrder,
  retryPaymentOrder,
};
