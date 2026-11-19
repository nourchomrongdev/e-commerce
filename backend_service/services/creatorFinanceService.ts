const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");

function isMoneyAmount(value, allowZero = false) {
  const amount = String(value ?? "").trim();
  return /^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)
    && (allowZero || !/^0(?:\.0{1,2})?$/.test(amount));
}

function encryptPayPalEmail(email) {
  const secret = process.env.PAYPAL_PAYOUT_ENCRYPTION_KEY;
  if (!secret) throw new Error("PAYPAL_PAYOUT_ENCRYPTION_KEY is required to store payout account data.");
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(email), "utf8"), cipher.final()]);
  return {
    encrypted: JSON.stringify({
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    }),
    fingerprint: crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex"),
  };
}

function decryptPayPalEmail(value) {
  const secret = process.env.PAYPAL_PAYOUT_ENCRYPTION_KEY;
  if (!secret) throw new Error("PAYPAL_PAYOUT_ENCRYPTION_KEY is required to read payout account data.");
  const parsed = JSON.parse(String(value));
  const key = crypto.createHash("sha256").update(secret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function maskPayPalEmail(email) {
  const [name, domain] = String(email || "").split("@");
  if (!name || !domain) return "";
  return `${name.slice(0, 1)}***@${domain}`;
}

async function recordPaidOrderEarnings({ paymentId, transaction, providerFee = null }) {
  const [payment] = await sequelize.query(
    `SELECT p."PaymentId", p."OrderId", p."PaymentMethod", p."Currency", p."PaidAt", p."Status"
     FROM "Payments" p
     WHERE p."PaymentId" = :paymentId
     FOR UPDATE`,
    { replacements: { paymentId }, type: QueryTypes.SELECT, transaction },
  );
  if (!payment || payment.Status !== "paid" || !payment.PaidAt) {
    throw new Error("Creator earnings can only be recorded for a verified paid payment.");
  }

  await sequelize.query(
    `INSERT INTO "CreatorEarnings"
       ("CreatorProfileId", "OrderId", "OrderItemId", "PaymentId", "ProductId",
        "PaymentMethod", "Currency", "SaleAmount", "CommissionRate",
        "MarketplaceCommission", "PaidAt", "EligibilityAt")
     SELECT s."CreatorProfileId", o."OrderId", oi."OrderItemId", p."PaymentId",
            oi."ProductId", LOWER(p."PaymentMethod"), o."Currency", oi."TotalAmount",
            settings."CommissionRate",
            ROUND(oi."TotalAmount" * settings."CommissionRate", 2),
            p."PaidAt", p."PaidAt" + INTERVAL '30 days'
     FROM "Payments" p
     JOIN "Orders" o ON o."OrderId" = p."OrderId"
     JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
     JOIN "Storefronts" s ON s."StorefrontId" = oi."StorefrontId"
     CROSS JOIN "MarketplaceFinanceSettings" settings
     WHERE p."PaymentId" = :paymentId
       AND p."Status" = 'paid'
       AND p."PaidAt" IS NOT NULL
       AND oi."TotalAmount" > 0
       AND settings."FinanceSettingId" = 1
     ON CONFLICT ("OrderItemId") DO NOTHING`,
    { replacements: { paymentId }, transaction },
  );

  const normalizedFee = providerFee
    && isMoneyAmount(providerFee.amount, true)
    && String(providerFee.currency || "").toUpperCase() === String(payment.Currency).trim().toUpperCase()
    ? String(providerFee.amount)
    : null;

  if (normalizedFee === null) {
    await sequelize.query(
      `INSERT INTO "CreatorEarningHolds"
         ("CreatorEarningId", "HoldType", "Reason", "IdempotencyKey")
       SELECT earning."CreatorEarningId", 'provider_fee_pending',
              'Payment provider fee has not been confirmed or reconciled.',
              'provider-fee-pending:' || earning."CreatorEarningId"
       FROM "CreatorEarnings" earning
       WHERE earning."PaymentId" = :paymentId
       ON CONFLICT ("IdempotencyKey") DO NOTHING`,
      { replacements: { paymentId }, transaction },
    );
    return;
  }

  await sequelize.query(
    `WITH items AS (
       SELECT earning."CreatorEarningId", earning."OrderItemId", earning."PaymentId",
              earning."SaleAmount",
              SUM(earning."SaleAmount") OVER (PARTITION BY earning."PaymentId") AS "ItemTotal",
              ROW_NUMBER() OVER (PARTITION BY earning."PaymentId" ORDER BY earning."OrderItemId") AS "ItemNumber",
              COUNT(*) OVER (PARTITION BY earning."PaymentId") AS "ItemCount"
       FROM "CreatorEarnings" earning
       WHERE earning."PaymentId" = :paymentId
     ),
     fee_shares AS (
       SELECT items.*,
              CASE
                WHEN "ItemNumber" = "ItemCount" THEN
                  CAST(:feeAmount AS NUMERIC(12,2)) - COALESCE(
                    SUM(ROUND(CAST(:feeAmount AS NUMERIC(12,2)) * "SaleAmount" / NULLIF("ItemTotal", 0), 2))
                      OVER (PARTITION BY "PaymentId" ORDER BY "OrderItemId"
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
                    0
                  )
                ELSE ROUND(CAST(:feeAmount AS NUMERIC(12,2)) * "SaleAmount" / NULLIF("ItemTotal", 0), 2)
              END AS "AllocatedFee"
       FROM items
     )
     INSERT INTO "CreatorEarningAdjustments"
       ("CreatorEarningId", "AdjustmentType", "Amount", "ProviderAmount", "Currency",
        "IdempotencyKey", "ExternalReference", "Reason")
     SELECT fee_shares."CreatorEarningId", 'processing_fee', fee_shares."AllocatedFee",
            fee_shares."AllocatedFee", earning."Currency",
            'payment-fee:' || :paymentId || ':' || fee_shares."OrderItemId",
            :paymentId::TEXT, 'Processing fee reported by the payment provider.'
     FROM fee_shares
     JOIN "CreatorEarnings" earning ON earning."CreatorEarningId" = fee_shares."CreatorEarningId"
     WHERE fee_shares."AllocatedFee" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM "CreatorEarningAdjustments" existing
         WHERE existing."CreatorEarningId" = fee_shares."CreatorEarningId"
           AND existing."AdjustmentType" = 'processing_fee'
       )
     ON CONFLICT ("IdempotencyKey") DO NOTHING`,
    { replacements: { paymentId, feeAmount: normalizedFee }, transaction },
  );

  await sequelize.query(
    `UPDATE "CreatorEarningHolds" hold
     SET "ReleasedAt" = CURRENT_TIMESTAMP
     FROM "CreatorEarnings" earning
     WHERE hold."CreatorEarningId" = earning."CreatorEarningId"
       AND earning."PaymentId" = :paymentId
       AND hold."HoldType" = 'provider_fee_pending'
       AND hold."ReleasedAt" IS NULL`,
    { replacements: { paymentId }, transaction },
  );
}

async function holdEarningsForPayment({ paymentId, holdType, reason, idempotencyKey, transaction, actorUserId = null }) {
  await sequelize.query(
    `INSERT INTO "CreatorEarningHolds"
       ("CreatorEarningId", "HoldType", "Reason", "IdempotencyKey", "CreatedByUserId")
     SELECT earning."CreatorEarningId", :holdType, :reason,
            :idempotencyKey || ':' || earning."CreatorEarningId", :actorUserId
     FROM "CreatorEarnings" earning
     WHERE earning."PaymentId" = :paymentId
     ON CONFLICT ("IdempotencyKey") DO NOTHING`,
    {
      replacements: { paymentId, holdType, reason, idempotencyKey, actorUserId },
      transaction,
    },
  );
}

async function releasePaymentHolds({ paymentId, holdType, idempotencyKey = null, transaction, actorUserId = null }) {
  await sequelize.query(
    `UPDATE "CreatorEarningHolds" hold
     SET "ReleasedAt" = CURRENT_TIMESTAMP, "ReleasedByUserId" = :actorUserId
     FROM "CreatorEarnings" earning
     WHERE hold."CreatorEarningId" = earning."CreatorEarningId"
       AND earning."PaymentId" = :paymentId
       AND hold."HoldType" = :holdType
       AND (:idempotencyKey IS NULL OR hold."IdempotencyKey" LIKE :idempotencyKey || ':%')
       AND hold."ReleasedAt" IS NULL`,
    { replacements: { paymentId, holdType, idempotencyKey, actorUserId }, transaction },
  );
}

function moneyToCents(value) {
  const amount = String(value ?? "").trim();
  if (!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)) throw new Error("Invalid monetary amount returned by the database.");
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function centsToMoney(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function isMissingFinanceSchemaError(error) {
  if (!error) return false;
  const message = String(error.message || error || "");
  const details = String(error?.parent?.message || "");
  return /does not exist|relation .* does not exist|column .* does not exist|missing.*column|missing.*table|table .* does not exist|unknown column|undefined column/i.test(`${message} ${details}`);
}

function emptyFinanceOverview(creatorId = null) {
  return {
    creatorProfileId: creatorId,
    summary: [{
      currency: "USD",
      totalSales: "0.00",
      grossEarnings: "0.00",
      marketplaceCommission: "0.00",
      paymentFees: "0.00",
      pendingEarnings: "0.00",
      availableEarnings: "0.00",
      onHoldAmount: "0.00",
    }],
    earnings: [],
    payouts: [],
    schedule: { scheduleType: "automatic_monthly", dayOfMonth: 1, isPaused: false },
    payoutAccount: null,
    settings: { commissionRate: "0.2000", minimumPayoutAmount: "100.00", payoutCurrency: "USD", monthlyPayoutDay: 1 },
  };
}

async function applyPaymentAdjustment({
  paymentId,
  adjustmentType,
  providerAmount,
  externalReference,
  reason,
  actorUserId = null,
  transaction,
}) {
  if (!["refund", "chargeback"].includes(adjustmentType)) throw new Error("Unsupported payment adjustment type.");
  if (!isMoneyAmount(providerAmount) || !String(externalReference || "").trim()) {
    throw new Error("A positive provider amount and external reference are required.");
  }

  const [payment] = await sequelize.query(
    `SELECT p."PaymentId", p."Currency", p."Amount"
     FROM "Payments" p WHERE p."PaymentId" = :paymentId FOR UPDATE`,
    { replacements: { paymentId }, type: QueryTypes.SELECT, transaction },
  );
  if (!payment) throw new Error("The payment does not exist.");
  const [duplicate] = await sequelize.query(
    `SELECT 1 AS found
     FROM "CreatorEarningAdjustments" adjustment
     JOIN "CreatorEarnings" earning ON earning."CreatorEarningId" = adjustment."CreatorEarningId"
     WHERE earning."PaymentId" = :paymentId
       AND adjustment."AdjustmentType" = :adjustmentType
       AND adjustment."ExternalReference" = :externalReference
     LIMIT 1`,
    {
      replacements: { paymentId, adjustmentType, externalReference: String(externalReference).slice(0, 255) },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  if (duplicate) return { inserted: 0, duplicate: true };

  const earnings = await sequelize.query(
    `SELECT earning."CreatorEarningId" AS id, earning."Currency" AS currency,
            earning."SaleAmount" AS "saleAmount",
            earning."MarketplaceCommission" AS commission,
            COALESCE((SELECT SUM(adjustment."Amount")
                      FROM "CreatorEarningAdjustments" adjustment
                      WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"), 0) AS adjustments,
            COALESCE((SELECT SUM(adjustment."ProviderAmount")
                      FROM "CreatorEarningAdjustments" adjustment
                      WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"
                        AND adjustment."AdjustmentType" IN ('refund', 'chargeback')), 0) AS "previousProviderAmount"
     FROM "CreatorEarnings" earning
     WHERE earning."PaymentId" = :paymentId
     ORDER BY earning."CreatorEarningId"
     FOR UPDATE`,
    { replacements: { paymentId }, type: QueryTypes.SELECT, transaction },
  );

  const eligible: Array<{ id: number | string; currency: string; remainingGross: bigint; remainingNet: bigint }> = earnings.map((earning) => {
    const gross = moneyToCents(earning.saleAmount) - moneyToCents(earning.previousProviderAmount);
    const net = moneyToCents(earning.saleAmount)
      - moneyToCents(earning.commission)
      - moneyToCents(earning.adjustments);
    return { ...earning, remainingGross: gross > 0n ? gross : 0n, remainingNet: net > 0n ? net : 0n };
  }).filter((earning) => earning.currency === payment.Currency && earning.remainingGross > 0n);
  const totalRemainingGross = eligible.reduce<bigint>((total, earning) => total + earning.remainingGross, 0n);
  const requestedCents = moneyToCents(providerAmount);
  const amountToAllocate = requestedCents < totalRemainingGross ? requestedCents : totalRemainingGross;
  if (amountToAllocate <= 0n) return { inserted: 0 };

  let allocatedGross = 0n;
  let inserted = 0;
  for (let index = 0; index < eligible.length; index += 1) {
    const earning = eligible[index];
    const isLast = index === eligible.length - 1;
    const remainingAllocation = amountToAllocate - allocatedGross;
    const proportionalShare = (amountToAllocate * earning.remainingGross + totalRemainingGross / 2n) / totalRemainingGross;
    const grossShare = isLast || proportionalShare > remainingAllocation
      ? remainingAllocation
      : proportionalShare;
    allocatedGross += grossShare;
    const netShare = earning.remainingNet > 0n
      ? (earning.remainingNet * grossShare + earning.remainingGross / 2n) / earning.remainingGross
      : 0n;
    if (grossShare <= 0n || netShare <= 0n) continue;

    await sequelize.query(
      `INSERT INTO "CreatorEarningAdjustments"
         ("CreatorEarningId", "AdjustmentType", "Amount", "ProviderAmount", "Currency",
          "IdempotencyKey", "ExternalReference", "Reason", "CreatedByUserId")
       VALUES (:earningId, :adjustmentType, :amount, :providerAmount, :currency,
               :idempotencyKey, :externalReference, :reason, :actorUserId)
       ON CONFLICT ("IdempotencyKey") DO NOTHING`,
      {
        replacements: {
          earningId: earning.id,
          adjustmentType,
          amount: centsToMoney(netShare),
          providerAmount: centsToMoney(grossShare),
          currency: earning.currency,
          idempotencyKey: `${adjustmentType}:${externalReference}:${earning.id}`.slice(0, 255),
          externalReference: String(externalReference).slice(0, 255),
          reason: String(reason || `Provider reported ${adjustmentType}.`).slice(0, 2000),
          actorUserId,
        },
        transaction,
      },
    );
    inserted += 1;
  }
  return { inserted };
}

async function releaseExpiredEarnings(transaction = null) {
  await sequelize.query(
    `INSERT INTO "CreatorEarningReleaseEvents" ("CreatorEarningId")
     SELECT earning."CreatorEarningId"
     FROM "CreatorEarnings" earning
     WHERE earning."EligibilityAt" <= CURRENT_TIMESTAMP
       AND NOT EXISTS (
         SELECT 1 FROM "CreatorEarningHolds" hold
         WHERE hold."CreatorEarningId" = earning."CreatorEarningId"
           AND hold."ReleasedAt" IS NULL
       )
     ON CONFLICT ("CreatorEarningId") DO NOTHING`,
    transaction ? { transaction } : undefined,
  );
}

async function getCreatorFinanceOverview(userId, { page = 1, pageSize = 25 } = {}) {
  let creator = null;
  try {
    [creator] = await sequelize.query(
      `SELECT cp."CreatorProfileId" AS id
       FROM "CreatorProfiles" cp
       WHERE cp."UserId" = :userId AND cp."IsActive" = TRUE
       LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    if (!creator) return null;

    const summary = await sequelize.query(
      `WITH earning_values AS (
         SELECT earning.*,
                COALESCE((SELECT SUM(adjustment."Amount")
                          FROM "CreatorEarningAdjustments" adjustment
                          WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"), 0) AS "Adjustments",
                COALESCE((SELECT SUM(adjustment."Amount")
                          FROM "CreatorEarningAdjustments" adjustment
                          WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"
                            AND adjustment."AdjustmentType" = 'processing_fee'), 0) AS "PaymentFees",
                COALESCE((SELECT SUM(adjustment."Amount")
                          FROM "CreatorEarningAdjustments" adjustment
                          WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"
                            AND adjustment."AdjustmentType" = 'refund'), 0) AS "Refunds",
                COALESCE((SELECT SUM(adjustment."Amount")
                          FROM "CreatorEarningAdjustments" adjustment
                          WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"
                            AND adjustment."AdjustmentType" = 'chargeback'), 0) AS "Chargebacks",
                COALESCE((SELECT SUM(item."Amount")
                          FROM "CreatorPayoutItems" item
                          JOIN "CreatorPayouts" payout ON payout."CreatorPayoutId" = item."CreatorPayoutId"
                          WHERE item."CreatorEarningId" = earning."CreatorEarningId"
                            AND payout."Status" IN ('draft', 'pending_approval', 'processing', 'paid')), 0) AS "ReservedOrPaid",
                EXISTS (SELECT 1 FROM "CreatorEarningHolds" hold
                        WHERE hold."CreatorEarningId" = earning."CreatorEarningId"
                          AND hold."ReleasedAt" IS NULL) AS "HasActiveHold",
                EXISTS (SELECT 1 FROM "CreatorEarningHolds" hold
                        WHERE hold."CreatorEarningId" = earning."CreatorEarningId"
                          AND hold."HoldType" = 'provider_fee_pending'
                          AND hold."ReleasedAt" IS NULL) AS "FeePending"
         FROM "CreatorEarnings" earning
         WHERE earning."CreatorProfileId" = :creatorId
       ),
       balances AS (
         SELECT earning_values.*,
                "SaleAmount" - "MarketplaceCommission" - "Adjustments" - "ReservedOrPaid" AS "Outstanding"
         FROM earning_values
       )
       SELECT "Currency" AS currency,
              COALESCE(SUM("SaleAmount"), 0) AS "totalSales",
              COALESCE(SUM("SaleAmount" - "MarketplaceCommission"), 0) AS "grossEarnings",
              COALESCE(SUM("MarketplaceCommission"), 0) AS "marketplaceCommission",
              COALESCE(SUM("PaymentFees"), 0) AS "paymentFees",
              COALESCE(SUM("Refunds"), 0) AS "refundedAmount",
              COALESCE(SUM("Chargebacks"), 0) AS "chargebackAmount",
              COALESCE(SUM(CASE WHEN "EligibilityAt" > CURRENT_TIMESTAMP
                                  AND NOT "HasActiveHold" AND NOT "FeePending"
                                THEN GREATEST("Outstanding", 0) ELSE 0 END), 0) AS "pendingEarnings",
              COALESCE(SUM(CASE WHEN "Currency" = 'USD'
                                  AND "EligibilityAt" <= CURRENT_TIMESTAMP
                                  AND NOT "HasActiveHold"
                                THEN "Outstanding" ELSE 0 END), 0) AS "availableEarnings",
              COALESCE(SUM(CASE WHEN "HasActiveHold" OR "FeePending" OR "Currency" <> 'USD'
                                THEN GREATEST("Outstanding", 0) ELSE 0 END), 0) AS "onHoldAmount"
       FROM balances
       GROUP BY "Currency"
       ORDER BY "Currency"`,
      { replacements: { creatorId: creator.id }, type: QueryTypes.SELECT },
    );

    const earnings = await sequelize.query(
      `WITH earning_values AS (
         SELECT earning."CreatorEarningId" AS id, earning."OrderId" AS "orderId",
                o."OrderNumber" AS "orderNumber", earning."OrderItemId" AS "orderItemId",
                earning."ProductId" AS "productId", oi."ProductName" AS "productName",
                earning."SaleAmount" AS "saleAmount",
                earning."MarketplaceCommission" AS "marketplaceCommission",
                COALESCE((SELECT SUM(adjustment."Amount") FROM "CreatorEarningAdjustments" adjustment
                          WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"
                            AND adjustment."AdjustmentType" = 'processing_fee'), 0) AS "paymentFee",
                COALESCE((SELECT SUM(adjustment."Amount") FROM "CreatorEarningAdjustments" adjustment
                          WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"), 0) AS "adjustments",
                COALESCE((SELECT SUM(item."Amount") FROM "CreatorPayoutItems" item
                          JOIN "CreatorPayouts" payout ON payout."CreatorPayoutId" = item."CreatorPayoutId"
                          WHERE item."CreatorEarningId" = earning."CreatorEarningId"
                            AND payout."Status" IN ('draft', 'pending_approval', 'processing', 'paid')), 0) AS "reservedOrPaid",
                earning."PaidAt" AS "paidAt", earning."EligibilityAt" AS "eligibilityAt",
                earning."PaymentMethod" AS "paymentMethod", earning."Currency" AS "currencyCode",
                EXISTS (SELECT 1 FROM "CreatorEarningHolds" hold
                        WHERE hold."CreatorEarningId" = earning."CreatorEarningId"
                          AND hold."ReleasedAt" IS NULL) AS "hasActiveHold"
         FROM "CreatorEarnings" earning
         JOIN "OrderItems" oi ON oi."OrderItemId" = earning."OrderItemId"
         JOIN "Orders" o ON o."OrderId" = earning."OrderId"
         WHERE earning."CreatorProfileId" = :creatorId
       )
       SELECT earning_values.*,
              "saleAmount" - "marketplaceCommission" - "adjustments" AS "netEarnings",
              "saleAmount" - "marketplaceCommission" - "adjustments" - "reservedOrPaid" AS "remainingAmount",
              CASE
                WHEN "hasActiveHold" OR "currencyCode" <> 'USD' THEN 'on_hold'
                WHEN "eligibilityAt" > CURRENT_TIMESTAMP THEN 'pending'
                WHEN "saleAmount" - "marketplaceCommission" - "adjustments" - "reservedOrPaid" <= 0 THEN 'paid_or_adjusted'
                ELSE 'available'
              END AS status
       FROM earning_values
       ORDER BY "paidAt" DESC, id DESC
       LIMIT :pageSize OFFSET :offset`,
      {
        replacements: {
          creatorId: creator.id,
          pageSize: Math.min(100, Math.max(1, Number(pageSize) || 25)),
          offset: (Math.max(1, Number(page) || 1) - 1) * Math.min(100, Math.max(1, Number(pageSize) || 25)),
        },
        type: QueryTypes.SELECT,
      },
    );

    const [payoutAccount] = await sequelize.query(
      `SELECT "PayPalEmailEncrypted" FROM "CreatorPayoutAccounts"
       WHERE "CreatorProfileId" = :creatorId`,
      { replacements: { creatorId: creator.id }, type: QueryTypes.SELECT },
    );
    let payoutEmail = null;
    if (payoutAccount?.PayPalEmailEncrypted) {
      payoutEmail = decryptPayPalEmail(payoutAccount.PayPalEmailEncrypted);
    }

    const [schedule] = await sequelize.query(
      `SELECT "ScheduleType" AS "scheduleType", "IntervalDays" AS "intervalDays",
              "DayOfMonth" AS "dayOfMonth", "NextPayoutAt" AS "nextPayoutAt",
              "IsPaused" AS "isPaused"
       FROM "CreatorPayoutSchedules"
       WHERE "CreatorProfileId" = :creatorId`,
      { replacements: { creatorId: creator.id }, type: QueryTypes.SELECT },
    );
    const payouts = await sequelize.query(
      `SELECT "UUID" AS id, "Amount" AS amount, "Currency" AS currency,
              "ExecutionMode" AS "executionMode", "PaymentMethod" AS "paymentMethod",
              "Status" AS status, "TransactionReference" AS "transactionReference",
              "FailureReason" AS "failureReason", "PaidAt" AS "paidAt",
              "CreatedAt" AS "createdAt"
       FROM "CreatorPayouts"
       WHERE "CreatorProfileId" = :creatorId
       ORDER BY "CreatedAt" DESC, "CreatorPayoutId" DESC
       LIMIT 100`,
      { replacements: { creatorId: creator.id }, type: QueryTypes.SELECT },
    );

    const [settings] = await sequelize.query(
      `SELECT "CommissionRate" AS "commissionRate",
              "MinimumPayoutAmount" AS "minimumPayoutAmount",
              "PayoutCurrency" AS "payoutCurrency",
              "MonthlyPayoutDay" AS "monthlyPayoutDay"
       FROM "MarketplaceFinanceSettings"
       WHERE "FinanceSettingId" = 1`,
      { type: QueryTypes.SELECT },
    );

    return {
      creatorProfileId: creator.id,
      summary,
      earnings,
      payouts,
      schedule: schedule || { scheduleType: "automatic_monthly", dayOfMonth: 1, isPaused: false },
      payoutAccount: payoutEmail ? { provider: "PayPal", maskedEmail: maskPayPalEmail(payoutEmail) } : null,
      settings,
    };
  } catch (error) {
    if (isMissingFinanceSchemaError(error) || /PAYPAL_PAYOUT_ENCRYPTION_KEY/.test(String(error.message || ""))) {
      return emptyFinanceOverview(creator?.id || null);
    }
    throw error;
  }
}

module.exports = {
  isMoneyAmount,
  encryptPayPalEmail,
  decryptPayPalEmail,
  maskPayPalEmail,
  recordPaidOrderEarnings,
  holdEarningsForPayment,
  releasePaymentHolds,
  applyPaymentAdjustment,
  releaseExpiredEarnings,
  getCreatorFinanceOverview,
};
