const express = require("express");
const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");
const finance = require("../services/creatorFinanceService");
const paypal = require("../services/paypalPayoutService");
const { createNotification, notifyRoles } = require("../services/notificationService");

const router = express.Router();
const VALID_PAYOUT_STATUSES = new Set(["pending_approval", "processing", "paid", "failed", "cancelled"]);

function reportFailure(res, error, operation) {
  console.error(`${operation} failed`, error);
  return res.status(Number(error.statusCode) || 500).json({
    error: Number(error.statusCode) ? error.message : `Unable to ${operation}.`,
  });
}

function parsePage(query) {
  const page = Number(query.page || 1);
  const pageSize = Number(query.pageSize || 25);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    const error = new Error("Page and pageSize must be positive integers.") as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  const size = Math.min(pageSize, 100);
  return { page, pageSize: size, offset: (page - 1) * size };
}

function parseCents(value) {
  const amount = String(value ?? "").trim();
  if (!finance.isMoneyAmount(amount)) throw new Error("Invalid monetary amount returned by the database.");
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function toMoney(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

async function findCreatorProfile(userId, transaction = null) {
  const [creator] = await sequelize.query(
    `SELECT cp."CreatorProfileId" AS id
     FROM "CreatorProfiles" cp
     WHERE cp."UserId" = :userId
       AND cp."IsActive" = TRUE
       AND cp."AccountApprovalStatus" = 'approved'
     LIMIT 1`,
    { replacements: { userId }, type: QueryTypes.SELECT, transaction },
  );
  return creator || null;
}

async function getAvailableEarnings(creatorId, transaction) {
  return sequelize.query(
    `SELECT earning."CreatorEarningId" AS id,
            earning."SaleAmount" - earning."MarketplaceCommission"
              - COALESCE((SELECT SUM(adjustment."Amount")
                          FROM "CreatorEarningAdjustments" adjustment
                          WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"), 0)
              - COALESCE((SELECT SUM(item."Amount")
                          FROM "CreatorPayoutItems" item
                          JOIN "CreatorPayouts" payout ON payout."CreatorPayoutId" = item."CreatorPayoutId"
                          WHERE item."CreatorEarningId" = earning."CreatorEarningId"
                            AND payout."Status" IN ('draft', 'pending_approval', 'processing', 'paid')), 0)
              AS "outstanding"
     FROM "CreatorEarnings" earning
     WHERE earning."CreatorProfileId" = :creatorId
       AND earning."Currency" = 'USD'
       AND earning."EligibilityAt" <= CURRENT_TIMESTAMP
       AND NOT EXISTS (
         SELECT 1 FROM "CreatorEarningHolds" hold
         WHERE hold."CreatorEarningId" = earning."CreatorEarningId"
           AND hold."ReleasedAt" IS NULL
       )
     ORDER BY earning."EligibilityAt", earning."CreatorEarningId"
     FOR UPDATE OF earning`,
    { replacements: { creatorId }, type: QueryTypes.SELECT, transaction },
  );
}

async function writePayoutEvent({ payoutId, eventType, previousStatus, nextStatus, actorUserId, details, transaction }) {
  await sequelize.query(
    `INSERT INTO "CreatorPayoutEvents"
       ("CreatorPayoutId", "EventType", "PreviousStatus", "NextStatus", "ActorUserId", "Details")
     VALUES (:payoutId, :eventType, :previousStatus, :nextStatus, :actorUserId, CAST(:details AS jsonb))`,
    {
      replacements: {
        payoutId,
        eventType,
        previousStatus,
        nextStatus,
        actorUserId: actorUserId || null,
        details: JSON.stringify(details || {}),
      },
      transaction,
    },
  );
}

async function notifyPayoutCreator({ userId, payoutId, status, amount, currency = "USD", attempt = 0, transaction }) {
  if (!userId || !["paid", "failed"].includes(status)) return;
  const isPaid = status === "paid";
  await createNotification(userId, {
    type: `payout.${status}`,
    title: isPaid ? "Payout sent" : "Payout needs attention",
    message: isPaid
      ? `Your ${currency} ${amount} creator payout has been sent.`
      : `Your ${currency} ${amount} creator payout failed. Review your payout details or contact support.`,
    relatedEntityType: "payout",
    relatedEntityId: payoutId,
    href: "/creator/payouts",
    dedupeKey: `creator-payout:${payoutId}:${status}:${attempt}`,
  }, { transaction });
}

module.exports = function createFinanceRoutes({ requireCreatorAccess, requireAdmin, requireSuperAdmin }) {
  router.get("/creator/finance/overview", requireCreatorAccess, async (req, res) => {
    try {
      const { page, pageSize } = parsePage(req.query);
      const overview = await finance.getCreatorFinanceOverview(req.userId, { page, pageSize });
      if (!overview) return res.status(404).json({ error: "Approved creator profile not found." });
      return res.json(overview);
    } catch (error) {
      return reportFailure(res, error, "load creator finance");
    }
  });

  router.put("/creator/finance/paypal-account", requireCreatorAccess, async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: "Enter a valid PayPal email address." });
    }
    try {
      const creator = await findCreatorProfile(req.userId);
      if (!creator) return res.status(404).json({ error: "Approved creator profile not found." });
      const encrypted = finance.encryptPayPalEmail(email);
      await sequelize.query(
        `INSERT INTO "CreatorPayoutAccounts"
           ("CreatorProfileId", "PayPalEmailEncrypted", "PayPalEmailFingerprint")
         VALUES (:creatorId, :encrypted, :fingerprint)
         ON CONFLICT ("CreatorProfileId") DO UPDATE
         SET "PayPalEmailEncrypted" = EXCLUDED."PayPalEmailEncrypted",
             "PayPalEmailFingerprint" = EXCLUDED."PayPalEmailFingerprint",
             "UpdatedAt" = CURRENT_TIMESTAMP`,
        {
          replacements: { creatorId: creator.id, encrypted: encrypted.encrypted, fingerprint: encrypted.fingerprint },
        },
      );
      return res.json({ message: "PayPal payout account saved.", maskedEmail: finance.maskPayPalEmail(email) });
    } catch (error) {
      return reportFailure(res, error, "save PayPal payout account");
    }
  });

  router.delete("/creator/finance/paypal-account", requireCreatorAccess, async (req, res) => {
    try {
      const creator = await findCreatorProfile(req.userId);
      if (!creator) return res.status(404).json({ error: "Approved creator profile not found." });
      const outcome = await sequelize.transaction(async (transaction) => {
        await sequelize.query(
          `SELECT "CreatorProfileId" FROM "CreatorProfiles"
           WHERE "CreatorProfileId" = :creatorId FOR UPDATE`,
          { replacements: { creatorId: creator.id }, transaction },
        );
        const [account] = await sequelize.query(
          `SELECT "CreatorPayoutAccountId" AS id
           FROM "CreatorPayoutAccounts"
           WHERE "CreatorProfileId" = :creatorId
           FOR UPDATE`,
          { replacements: { creatorId: creator.id }, type: QueryTypes.SELECT, transaction },
        );
        if (!account) return { status: 404, error: "No PayPal payout account is saved." };
        const [activePayout] = await sequelize.query(
          `SELECT "CreatorPayoutId" FROM "CreatorPayouts"
           WHERE "CreatorProfileId" = :creatorId
             AND "PaymentMethod" = 'PayPal'
             AND "Status" IN ('pending_approval', 'processing')
           LIMIT 1`,
          { replacements: { creatorId: creator.id }, type: QueryTypes.SELECT, transaction },
        );
        if (activePayout) return { status: 409, error: "Resolve pending payouts before removing the PayPal account." };
        await sequelize.query(
          `DELETE FROM "CreatorPayoutAccounts"
           WHERE "CreatorPayoutAccountId" = :accountId`,
          { replacements: { accountId: account.id }, transaction },
        );
        return { status: 200 };
      });
      if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
      return res.json({ message: "PayPal payout account removed." });
    } catch (error) {
      return reportFailure(res, error, "remove PayPal payout account");
    }
  });

  router.put("/creator/finance/schedule", requireCreatorAccess, async (req, res) => {
    const scheduleType = String(req.body?.scheduleType || "").trim();
    const allowed = new Set(["automatic_monthly", "every_n_days", "monthly_day", "custom_date", "manual_only"]);
    if (!allowed.has(scheduleType)) return res.status(400).json({ error: "Unsupported payout schedule." });
    const intervalDays = Number(req.body?.intervalDays);
    const dayOfMonth = Number(req.body?.dayOfMonth);
    const customDate = req.body?.nextPayoutAt ? new Date(req.body.nextPayoutAt) : null;
    if (scheduleType === "every_n_days" && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365)) {
      return res.status(400).json({ error: "Interval must be between 1 and 365 days." });
    }
    if (scheduleType === "monthly_day" && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28)) {
      return res.status(400).json({ error: "Monthly payout day must be between 1 and 28." });
    }
    if (scheduleType === "custom_date" && (!customDate || Number.isNaN(customDate.getTime()) || customDate <= new Date())) {
      return res.status(400).json({ error: "Choose a future payout date." });
    }

    try {
      const creator = await findCreatorProfile(req.userId);
      if (!creator) return res.status(404).json({ error: "Approved creator profile not found." });
      let nextPayoutAt = scheduleType === "custom_date" ? customDate : null;
      if (scheduleType === "every_n_days") {
        nextPayoutAt = new Date(Date.now() + intervalDays * 86_400_000);
      } else if (scheduleType === "monthly_day") {
        const now = new Date();
        const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayOfMonth));
        if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1);
        nextPayoutAt = next;
      }
      await sequelize.query(
        `INSERT INTO "CreatorPayoutSchedules"
           ("CreatorProfileId", "ScheduleType", "IntervalDays", "DayOfMonth", "NextPayoutAt", "IsPaused", "UpdatedByUserId")
         VALUES (:creatorId, :scheduleType, :intervalDays, :dayOfMonth, :nextPayoutAt, FALSE, :userId)
         ON CONFLICT ("CreatorProfileId") DO UPDATE SET
           "ScheduleType" = EXCLUDED."ScheduleType",
           "IntervalDays" = EXCLUDED."IntervalDays",
           "DayOfMonth" = EXCLUDED."DayOfMonth",
           "NextPayoutAt" = EXCLUDED."NextPayoutAt",
           "IsPaused" = FALSE,
           "UpdatedByUserId" = EXCLUDED."UpdatedByUserId",
           "UpdatedAt" = CURRENT_TIMESTAMP`,
        {
          replacements: {
            creatorId: creator.id,
            scheduleType,
            intervalDays: scheduleType === "every_n_days" ? intervalDays : null,
            dayOfMonth: scheduleType === "monthly_day" ? dayOfMonth : null,
            nextPayoutAt,
            userId: req.userId,
          },
        },
      );
      return res.json({ message: "Payout schedule saved." });
    } catch (error) {
      return reportFailure(res, error, "save payout schedule");
    }
  });

  router.post("/creator/finance/payouts/request", requireCreatorAccess, async (req, res) => {
    try {
      const outcome = await sequelize.transaction(async (transaction) => {
        const creator = await findCreatorProfile(req.userId, transaction);
        if (!creator) return { status: 404, error: "Approved creator profile not found." };
        const [lockedCreator] = await sequelize.query(
          `SELECT "CreatorProfileId" FROM "CreatorProfiles"
           WHERE "CreatorProfileId" = :creatorId FOR UPDATE`,
          { replacements: { creatorId: creator.id }, type: QueryTypes.SELECT, transaction },
        );
        if (!lockedCreator) return { status: 404, error: "Approved creator profile not found." };
        const [account] = await sequelize.query(
          `SELECT "CreatorPayoutAccountId" FROM "CreatorPayoutAccounts"
           WHERE "CreatorProfileId" = :creatorId`,
          { replacements: { creatorId: creator.id }, type: QueryTypes.SELECT, transaction },
        );
        if (!account) return { status: 409, error: "Add a PayPal payout account before requesting a payout." };
        const [settings] = await sequelize.query(
          `SELECT "MinimumPayoutAmount" FROM "MarketplaceFinanceSettings" WHERE "FinanceSettingId" = 1`,
          { type: QueryTypes.SELECT, transaction },
        );
        const earnings = await getAvailableEarnings(creator.id, transaction);
        const available = earnings.reduce((total, earning) => total + parseCents(earning.outstanding), 0n);
        const minimum = parseCents(settings.MinimumPayoutAmount);
        if (available < minimum) {
          return { status: 409, error: `Available USD earnings must meet the $${toMoney(minimum)} minimum payout.` };
        }

        const payoutIdempotencyKey = `creator-request:${creator.id}:${crypto.randomUUID()}`;
        const [payout] = await sequelize.query(
          `INSERT INTO "CreatorPayouts"
             ("CreatorProfileId", "ExecutionMode", "PaymentMethod", "Amount", "Currency",
              "Status", "IdempotencyKey", "CreatedByUserId")
           VALUES (:creatorId, 'manual', 'PayPal', :amount, 'USD',
                   'pending_approval', :idempotencyKey, :userId)
           RETURNING "CreatorPayoutId" AS id, "UUID" AS uuid, "Amount" AS amount, "Status" AS status`,
          {
            replacements: {
              creatorId: creator.id,
              amount: toMoney(available),
              idempotencyKey: payoutIdempotencyKey,
              userId: req.userId,
            },
            type: QueryTypes.SELECT,
            transaction,
          },
        );

        let remaining = available;
        for (const earning of earnings) {
          const balance = parseCents(earning.outstanding);
          if (balance <= 0n || remaining <= 0n) continue;
          const allocation = balance < remaining ? balance : remaining;
          await sequelize.query(
            `INSERT INTO "CreatorPayoutItems" ("CreatorPayoutId", "CreatorEarningId", "Amount")
             VALUES (:payoutId, :earningId, :amount)`,
            {
              replacements: { payoutId: payout.id, earningId: earning.id, amount: toMoney(allocation) },
              transaction,
            },
          );
          remaining -= allocation;
        }
        if (remaining !== 0n) throw new Error("Payout allocation did not match the available balance.");
        await writePayoutEvent({
          payoutId: payout.id,
          eventType: "creator_requested",
          previousStatus: null,
          nextStatus: "pending_approval",
          actorUserId: req.userId,
          details: { amount: payout.amount, currency: "USD" },
          transaction,
        });
        await notifyRoles(["admin", "superadmin"], {
          type: "payout.requested",
          title: "Creator payout requested",
          message: `A creator requested a payout of USD ${payout.amount}.`,
          relatedEntityType: "payout",
          relatedEntityId: payout.id,
          href: "/admin/payouts",
          dedupeKey: `creator-payout-request:${payout.id}`,
        }, { transaction, excludeUserIds: [req.userId] });
        return { payout };
      });
      if (outcome.status) return res.status(outcome.status).json({ error: outcome.error });
      return res.status(201).json({ payout: outcome.payout });
    } catch (error) {
      return reportFailure(res, error, "request creator payout");
    }
  });

  router.get("/admin/finance/settings", requireAdmin, async (_req, res) => {
    try {
      const [settings] = await sequelize.query(
        `SELECT "CommissionRate" AS "commissionRate", "MinimumPayoutAmount" AS "minimumPayoutAmount",
                "PayoutCurrency" AS "payoutCurrency", "MonthlyPayoutDay" AS "monthlyPayoutDay",
                "AutomaticPayoutsEnabled" AS "automaticPayoutsEnabled"
         FROM "MarketplaceFinanceSettings" WHERE "FinanceSettingId" = 1`,
        { type: QueryTypes.SELECT },
      );
      return res.json({ settings, paypal: paypal.getPayoutsConfigurationStatus() });
    } catch (error) {
      return reportFailure(res, error, "load finance settings");
    }
  });

  router.get("/admin/finance/holds", requireAdmin, async (req, res) => {
    try {
      const { pageSize, offset } = parsePage(req.query);
      const holds = await sequelize.query(
        `SELECT hold."CreatorEarningHoldId" AS id, hold."HoldType" AS "holdType",
                hold."Reason" AS reason, hold."CreatedAt" AS "createdAt",
                earning."CreatorEarningId" AS "earningId", earning."Currency" AS currency,
                earning."SaleAmount" AS "saleAmount", earning."PaymentMethod" AS "paymentMethod",
                earning."PaidAt" AS "paidAt", oi."ProductName" AS "productName",
                cp."DisplayName" AS "creatorName", cp."Username" AS "creatorUsername"
         FROM "CreatorEarningHolds" hold
         JOIN "CreatorEarnings" earning ON earning."CreatorEarningId" = hold."CreatorEarningId"
         JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = earning."CreatorProfileId"
         JOIN "OrderItems" oi ON oi."OrderItemId" = earning."OrderItemId"
         WHERE hold."ReleasedAt" IS NULL
         ORDER BY hold."CreatedAt", hold."CreatorEarningHoldId"
         LIMIT :pageSize OFFSET :offset`,
        { replacements: { pageSize, offset }, type: QueryTypes.SELECT },
      );
      return res.json({ holds });
    } catch (error) {
      return reportFailure(res, error, "load earnings holds");
    }
  });

  router.put("/admin/finance/settings", requireSuperAdmin, async (req, res) => {
    const commissionRate = String(req.body?.commissionRate ?? "");
    const minimumPayoutAmount = String(req.body?.minimumPayoutAmount ?? "");
    const automaticPayoutsEnabled = req.body?.automaticPayoutsEnabled;
    if (!/^(0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/.test(commissionRate)
        || !finance.isMoneyAmount(minimumPayoutAmount)
        || typeof automaticPayoutsEnabled !== "boolean") {
      return res.status(400).json({ error: "Commission, minimum payout, and automatic payout settings are invalid." });
    }
    try {
      await sequelize.query(
        `UPDATE "MarketplaceFinanceSettings"
         SET "CommissionRate" = :commissionRate,
             "MinimumPayoutAmount" = :minimumPayoutAmount,
             "AutomaticPayoutsEnabled" = :automaticPayoutsEnabled,
             "UpdatedByUserId" = :userId,
             "UpdatedAt" = CURRENT_TIMESTAMP
         WHERE "FinanceSettingId" = 1`,
        { replacements: { commissionRate, minimumPayoutAmount, automaticPayoutsEnabled, userId: req.userId } },
      );
      return res.json({ message: "Finance settings saved." });
    } catch (error) {
      return reportFailure(res, error, "save finance settings");
    }
  });

  router.get("/admin/finance/payouts", requireAdmin, async (req, res) => {
    try {
      const { page, pageSize, offset } = parsePage(req.query);
      const status = String(req.query.status || "").trim();
      const search = String(req.query.search || "").trim().slice(0, 100);
      if (status && !VALID_PAYOUT_STATUSES.has(status)) return res.status(400).json({ error: "Invalid payout status filter." });
      const replacements: Record<string, unknown> = { pageSize, offset, search: `%${search}%` };
      const conditions = [];
      if (status) {
        conditions.push(`payout."Status" = :status`);
        replacements.status = status;
      }
      if (search) {
        conditions.push(`(cp."DisplayName" ILIKE :search OR cp."Username" ILIKE :search OR payout."UUID"::text ILIKE :search)`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const [count] = await sequelize.query(
        `SELECT COUNT(*)::int AS total
         FROM "CreatorPayouts" payout
         JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = payout."CreatorProfileId"
         ${where}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const payouts = await sequelize.query(
        `SELECT payout."CreatorPayoutId" AS id, payout."UUID" AS uuid,
                payout."Amount" AS amount, payout."Currency" AS currency,
                payout."PaymentMethod" AS "paymentMethod", payout."ExecutionMode" AS "executionMode",
                payout."Status" AS status, payout."TransactionReference" AS "transactionReference",
                payout."FailureReason" AS "failureReason", payout."ProviderStatus" AS "providerStatus",
                payout."ProviderBatchId" AS "providerBatchId",
                payout."CreatedAt" AS "createdAt", payout."PaidAt" AS "paidAt",
                cp."DisplayName" AS "creatorName", cp."Username" AS "creatorUsername"
         FROM "CreatorPayouts" payout
         JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = payout."CreatorProfileId"
         ${where}
         ORDER BY payout."CreatedAt" DESC, payout."CreatorPayoutId" DESC
         LIMIT :pageSize OFFSET :offset`,
        { replacements, type: QueryTypes.SELECT },
      );
      return res.json({ payouts, pagination: { page, pageSize, total: count.total } });
    } catch (error) {
      return reportFailure(res, error, "load creator payouts");
    }
  });

  router.post("/admin/finance/earnings/:earningId/reconcile-fee", requireSuperAdmin, async (req, res) => {
    const amount = String(req.body?.amount ?? "");
    const externalReference = String(req.body?.externalReference || "").trim().slice(0, 255);
    const reason = String(req.body?.reason || "Provider fee confirmed during reconciliation.").trim().slice(0, 2000);
    if (!finance.isMoneyAmount(amount, true)) return res.status(400).json({ error: "Enter a valid non-negative fee amount." });
    try {
      const result = await sequelize.transaction(async (transaction) => {
        const [earning] = await sequelize.query(
          `SELECT earning."CreatorEarningId" AS id, earning."Currency" AS currency
           FROM "CreatorEarnings" earning
           WHERE earning."CreatorEarningId" = :earningId
           FOR UPDATE`,
          { replacements: { earningId: req.params.earningId }, type: QueryTypes.SELECT, transaction },
        );
        if (!earning) return { status: 404, error: "Creator earning not found." };
        const [existingFee] = await sequelize.query(
          `SELECT "CreatorEarningAdjustmentId" FROM "CreatorEarningAdjustments"
           WHERE "CreatorEarningId" = :earningId AND "AdjustmentType" = 'processing_fee'`,
          { replacements: { earningId: earning.id }, type: QueryTypes.SELECT, transaction },
        );
        if (existingFee) return { status: 409, error: "This earning already has a confirmed processing fee." };
        const [hold] = await sequelize.query(
          `SELECT "CreatorEarningHoldId" FROM "CreatorEarningHolds"
           WHERE "CreatorEarningId" = :earningId
             AND "HoldType" = 'provider_fee_pending'
             AND "ReleasedAt" IS NULL
           FOR UPDATE`,
          { replacements: { earningId: earning.id }, type: QueryTypes.SELECT, transaction },
        );
        if (!hold) return { status: 409, error: "This earning is not awaiting provider-fee reconciliation." };

        await sequelize.query(
          `INSERT INTO "CreatorEarningAdjustments"
             ("CreatorEarningId", "AdjustmentType", "Amount", "ProviderAmount", "Currency",
              "IdempotencyKey", "ExternalReference", "Reason", "CreatedByUserId")
           VALUES (:earningId, 'processing_fee', :amount, :amount, :currency,
                   :idempotencyKey, :externalReference, :reason, :userId)`,
          {
            replacements: {
              earningId: earning.id,
              amount,
              currency: earning.currency,
              idempotencyKey: `fee-reconcile:${earning.id}`,
              externalReference: externalReference || null,
              reason,
              userId: req.userId,
            },
            transaction,
          },
        );
        await sequelize.query(
          `UPDATE "CreatorEarningHolds"
           SET "ReleasedAt" = CURRENT_TIMESTAMP, "ReleasedByUserId" = :userId
           WHERE "CreatorEarningHoldId" = :holdId`,
          { replacements: { userId: req.userId, holdId: hold.CreatorEarningHoldId }, transaction },
        );
        return { status: 200 };
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.json({ message: "Provider fee reconciled and earnings hold released." });
    } catch (error) {
      return reportFailure(res, error, "reconcile provider fee");
    }
  });

  router.post("/admin/finance/payouts/:payoutId/mark-paid", requireSuperAdmin, async (req, res) => {
    const reference = String(req.body?.transactionReference || "").trim().slice(0, 255);
    if (!reference) return res.status(400).json({ error: "Enter the bank or provider transaction reference." });
    try {
      const outcome = await sequelize.transaction(async (transaction) => {
        const [payout] = await sequelize.query(
          `SELECT payout."CreatorPayoutId" AS id, payout."Status" AS status,
                  payout."ExecutionMode" AS "executionMode", payout."Amount" AS amount,
                  payout."Currency" AS currency, creator."UserId" AS "creatorUserId"
           FROM "CreatorPayouts" payout
           JOIN "CreatorProfiles" creator ON creator."CreatorProfileId" = payout."CreatorProfileId"
           WHERE payout."CreatorPayoutId" = :payoutId FOR UPDATE OF payout`,
          { replacements: { payoutId: req.params.payoutId }, type: QueryTypes.SELECT, transaction },
        );
        if (!payout) return { status: 404, error: "Payout not found." };
        if (payout.status !== "pending_approval" || payout.executionMode === "paypal") {
          return { status: 409, error: `A payout with status ${payout.status} cannot be marked paid.` };
        }
        await sequelize.query(
          `UPDATE "CreatorPayouts"
           SET "Status" = 'paid', "ExecutionMode" = 'manual',
               "TransactionReference" = :reference, "PaidAt" = CURRENT_TIMESTAMP,
               "ProcessedByUserId" = :userId, "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "CreatorPayoutId" = :payoutId`,
          { replacements: { reference, userId: req.userId, payoutId: payout.id }, transaction },
        );
        await writePayoutEvent({
          payoutId: payout.id,
          eventType: "manual_payout_marked_paid",
          previousStatus: payout.status,
          nextStatus: "paid",
          actorUserId: req.userId,
          details: { transactionReference: reference },
          transaction,
        });
        await notifyPayoutCreator({
          userId: payout.creatorUserId,
          payoutId: payout.id,
          status: "paid",
          amount: payout.amount,
          currency: payout.currency,
          transaction,
        });
        return { status: 200 };
      });
      if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
      return res.json({ message: "Payout marked as paid." });
    } catch (error) {
      return reportFailure(res, error, "record manual payout");
    }
  });

  router.post("/admin/finance/payouts/:payoutId/send-paypal", requireSuperAdmin, async (req, res) => {
    if (!paypal.getPayoutsConfigurationStatus().configured) {
      return res.status(503).json({ error: "PayPal Payouts is disabled or not configured." });
    }
    let payout;
    let recipientEmail;
    try {
      const start = await sequelize.transaction(async (transaction) => {
        const [record] = await sequelize.query(
          `SELECT payout."CreatorPayoutId" AS id, payout."CreatorProfileId" AS "creatorId",
                  payout."Status" AS status, payout."Amount" AS amount, payout."Currency" AS currency,
                  payout."RetryCount" AS "retryCount", account."PayPalEmailEncrypted" AS "encryptedEmail"
           FROM "CreatorPayouts" payout
           LEFT JOIN "CreatorPayoutAccounts" account ON account."CreatorProfileId" = payout."CreatorProfileId"
           WHERE payout."CreatorPayoutId" = :payoutId
           FOR UPDATE OF payout`,
          { replacements: { payoutId: req.params.payoutId }, type: QueryTypes.SELECT, transaction },
        );
        if (!record) return { status: 404, error: "Payout not found." };
        if (record.status !== "pending_approval" && record.status !== "failed") {
          return { status: 409, error: `A payout with status ${record.status} cannot be submitted to PayPal.` };
        }
        if (!record.encryptedEmail) return { status: 409, error: "The creator has not saved a PayPal payout account." };
        recipientEmail = finance.decryptPayPalEmail(record.encryptedEmail);
        const previousStatus = record.status;
        await sequelize.query(
          `UPDATE "CreatorPayouts"
           SET "Status" = 'processing', "ExecutionMode" = 'paypal', "RetryCount" = "RetryCount" + 1,
               "FailureReason" = NULL, "ApprovedByUserId" = COALESCE("ApprovedByUserId", :userId),
               "ProcessedByUserId" = :userId, "ProviderRequestId" = :requestId,
               "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "CreatorPayoutId" = :payoutId`,
          {
            replacements: {
              userId: req.userId,
              payoutId: record.id,
              requestId: `kd-payout-${record.id}-${record.retryCount}`,
            },
            transaction,
          },
        );
        await writePayoutEvent({
          payoutId: record.id,
          eventType: "paypal_submission_started",
          previousStatus,
          nextStatus: "processing",
          actorUserId: req.userId,
          details: {},
          transaction,
        });
        return { record };
      });
      if (start.error) return res.status(start.status).json({ error: start.error });
      payout = start.record;
    } catch (error) {
      return reportFailure(res, error, "prepare PayPal payout");
    }

    try {
      const result = await paypal.createPayoutBatch({
        payoutId: payout.id,
        retryCount: payout.retryCount,
        recipientEmail,
        amount: payout.amount,
        currency: payout.currency,
      });
      if (!result.batchId) {
        throw new Error("PayPal did not return a batch ID; the submission outcome is uncertain.");
      }
      await sequelize.transaction(async (transaction) => {
        await sequelize.query(
          `UPDATE "CreatorPayouts"
           SET "ProviderBatchId" = :batchId, "ProviderItemId" = :itemId,
               "ProviderStatus" = :providerStatus, "ProviderResponse" = CAST(:providerResponse AS jsonb),
               "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "CreatorPayoutId" = :payoutId`,
          {
            replacements: {
              payoutId: payout.id,
              batchId: result.batchId,
              itemId: result.itemId,
              providerStatus: result.itemStatus || result.batchStatus,
              providerResponse: JSON.stringify(result.response),
            },
            transaction,
          },
        );
        await writePayoutEvent({
          payoutId: payout.id,
          eventType: "paypal_batch_created",
          previousStatus: "processing",
          nextStatus: "processing",
          actorUserId: req.userId,
          details: { batchId: result.batchId, itemId: result.itemId, providerStatus: result.itemStatus || result.batchStatus },
          transaction,
        });
      });
      return res.json({ message: "PayPal payout submitted; awaiting provider confirmation.", payout: { id: payout.id, batchId: result.batchId, status: "processing" } });
    } catch (error) {
      await sequelize.transaction(async (transaction) => {
        await sequelize.query(
          `UPDATE "CreatorPayouts"
           SET "FailureReason" = :failureReason, "ProviderResponse" = CAST(:providerResponse AS jsonb),
               "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "CreatorPayoutId" = :payoutId AND "Status" = 'processing'`,
          {
            replacements: {
              payoutId: payout.id,
              failureReason: "PayPal submission outcome is uncertain; verify the batch before retrying.",
              providerResponse: JSON.stringify({ error: error.message, statusCode: error.statusCode || null }),
            },
            transaction,
          },
        );
        await writePayoutEvent({
          payoutId: payout.id,
          eventType: "paypal_submission_uncertain",
          previousStatus: "processing",
          nextStatus: "processing",
          actorUserId: req.userId,
          details: { statusCode: error.statusCode || null },
          transaction,
        });
      });
      return res.status(Number(error.statusCode) || 502).json({
        error: "PayPal submission may have reached the provider. Verify the payout batch before retrying.",
      });
    }
  });

  router.post("/admin/finance/payouts/:payoutId/sync-paypal", requireSuperAdmin, async (req, res) => {
    try {
      const [payout] = await sequelize.query(
        `SELECT payout."CreatorPayoutId" AS id, payout."Status" AS status,
                payout."ProviderBatchId" AS "batchId", payout."Amount" AS amount,
                payout."Currency" AS currency, payout."RetryCount" AS "retryCount",
                creator."UserId" AS "creatorUserId"
         FROM "CreatorPayouts" payout
         JOIN "CreatorProfiles" creator ON creator."CreatorProfileId" = payout."CreatorProfileId"
         WHERE payout."CreatorPayoutId" = :payoutId`,
        { replacements: { payoutId: req.params.payoutId }, type: QueryTypes.SELECT },
      );
      if (!payout) return res.status(404).json({ error: "Payout not found." });
      if (payout.status !== "processing") return res.status(409).json({ error: "Only processing PayPal payouts can be synchronized." });
      if (!payout.batchId) return res.status(409).json({ error: "PayPal has not returned a batch ID for this payout; verify it with PayPal before taking further action." });

      const response = await paypal.getPayoutBatch(payout.batchId);
      const item = response.items?.[0];
      const providerStatus = String(item?.transaction_status || response.batch_header?.batch_status || "").toUpperCase();
      const nextStatus = ["SUCCESS", "SUCCESSFUL"].includes(providerStatus)
        ? "paid"
        : ["FAILED", "BLOCKED", "RETURNED", "DENIED", "UNCLAIMED"].includes(providerStatus)
          ? "failed"
          : "processing";
      await sequelize.transaction(async (transaction) => {
        await sequelize.query(
          `UPDATE "CreatorPayouts"
           SET "Status" = :nextStatus, "ProviderStatus" = :providerStatus,
               "ProviderItemId" = COALESCE(:itemId, "ProviderItemId"),
               "TransactionReference" = COALESCE(:transactionReference, "TransactionReference"),
               "PaidAt" = CASE WHEN :nextStatus = 'paid' THEN COALESCE("PaidAt", CURRENT_TIMESTAMP) ELSE "PaidAt" END,
               "FailureReason" = CASE WHEN :nextStatus = 'failed' THEN :failureReason ELSE NULL END,
               "ProviderResponse" = CAST(:providerResponse AS jsonb), "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "CreatorPayoutId" = :payoutId`,
          {
            replacements: {
              payoutId: payout.id,
              nextStatus,
              providerStatus,
              itemId: item?.payout_item_id || null,
              transactionReference: item?.transaction_id || null,
              failureReason: nextStatus === "failed" ? `PayPal payout status: ${providerStatus}` : null,
              providerResponse: JSON.stringify(response),
            },
            transaction,
          },
        );
        await writePayoutEvent({
          payoutId: payout.id,
          eventType: "paypal_batch_synchronized",
          previousStatus: payout.status,
          nextStatus,
          actorUserId: req.userId,
          details: { providerStatus },
          transaction,
        });
        await notifyPayoutCreator({
          userId: payout.creatorUserId,
          payoutId: payout.id,
          status: nextStatus,
          amount: payout.amount,
          currency: payout.currency,
          attempt: payout.retryCount,
          transaction,
        });
      });
      return res.json({ message: "PayPal payout status synchronized.", status: nextStatus });
    } catch (error) {
      return reportFailure(res, error, "synchronize PayPal payout");
    }
  });

  router.post("/payments/paypal/payouts/webhook", async (req, res) => {
    const event = req.body;
    if (!event || typeof event !== "object" || !event.id || !event.event_type) {
      return res.status(400).json({ error: "Invalid PayPal webhook event." });
    }
    try {
      const verified = await paypal.verifyWebhook(req.headers, event);
      if (!verified) return res.status(400).json({ error: "PayPal webhook signature verification failed." });
      const outcome = await sequelize.transaction(async (transaction) => {
        const [inserted] = await sequelize.query(
          `INSERT INTO "PayPalPayoutWebhookEvents" ("ProviderEventId", "EventType")
           VALUES (:eventId, :eventType)
           ON CONFLICT ("ProviderEventId") DO NOTHING
           RETURNING "PayPalPayoutWebhookEventId"`,
          { replacements: { eventId: String(event.id), eventType: String(event.event_type) }, type: QueryTypes.SELECT, transaction },
        );
        if (!inserted) return { duplicate: true };

        const resource = event.resource || {};
        const batchId = resource.payout_batch_id || resource.batch_header?.payout_batch_id || null;
        const itemId = resource.payout_item_id || resource.payout_item?.payout_item_id || null;
        const [payout] = await sequelize.query(
          `SELECT payout."CreatorPayoutId" AS id, payout."Status" AS status,
                  payout."Amount" AS amount, payout."Currency" AS currency,
                  payout."RetryCount" AS "retryCount", creator."UserId" AS "creatorUserId"
           FROM "CreatorPayouts" payout
           JOIN "CreatorProfiles" creator ON creator."CreatorProfileId" = payout."CreatorProfileId"
           WHERE (:batchId IS NOT NULL AND payout."ProviderBatchId" = :batchId)
              OR (:itemId IS NOT NULL AND payout."ProviderItemId" = :itemId)
           ORDER BY payout."CreatorPayoutId" DESC LIMIT 1 FOR UPDATE OF payout`,
          { replacements: { batchId, itemId }, type: QueryTypes.SELECT, transaction },
        );
        if (!payout) return { unmatched: true };
        const eventType = String(event.event_type).toUpperCase();
        const itemStatus = String(resource.transaction_status || resource.batch_status || "").toUpperCase();
        const nextStatus = eventType.endsWith(".SUCCEEDED") || itemStatus === "SUCCESS" || itemStatus === "SUCCESSFUL"
          ? "paid"
          : ["FAILED", "BLOCKED", "RETURNED", "DENIED", "UNCLAIMED"].some((value) => eventType.endsWith(`.${value}`) || itemStatus === value)
            ? "failed"
            : "processing";
        const transactionReference = resource.transaction_id || null;
        await sequelize.query(
          `UPDATE "CreatorPayouts"
           SET "Status" = :nextStatus, "ProviderStatus" = :providerStatus,
               "TransactionReference" = COALESCE(:transactionReference, "TransactionReference"),
               "PaidAt" = CASE WHEN :nextStatus = 'paid' THEN COALESCE("PaidAt", CURRENT_TIMESTAMP) ELSE "PaidAt" END,
               "FailureReason" = CASE WHEN :nextStatus = 'failed' THEN :failureReason ELSE NULL END,
               "ProviderResponse" = CAST(:providerResponse AS jsonb), "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "CreatorPayoutId" = :payoutId`,
          {
            replacements: {
              payoutId: payout.id,
              nextStatus,
              providerStatus: itemStatus || eventType,
              transactionReference,
              failureReason: nextStatus === "failed" ? `PayPal payout event: ${eventType}` : null,
              providerResponse: JSON.stringify(resource),
            },
            transaction,
          },
        );
        await sequelize.query(
          `UPDATE "PayPalPayoutWebhookEvents"
           SET "CreatorPayoutId" = :payoutId
           WHERE "ProviderEventId" = :eventId`,
          { replacements: { payoutId: payout.id, eventId: String(event.id) }, transaction },
        );
        await writePayoutEvent({
          payoutId: payout.id,
          eventType: `paypal_webhook:${eventType.toLowerCase()}`,
          previousStatus: payout.status,
          nextStatus,
          actorUserId: null,
          details: { providerEventId: event.id, itemStatus },
          transaction,
        });
        await notifyPayoutCreator({
          userId: payout.creatorUserId,
          payoutId: payout.id,
          status: nextStatus,
          amount: payout.amount,
          currency: payout.currency,
          attempt: payout.retryCount,
          transaction,
        });
        return { matched: true };
      });
      return res.status(200).json({ received: true, ...outcome });
    } catch (error) {
      return reportFailure(res, error, "process PayPal payout webhook");
    }
  });

  router.post("/payments/paypal/webhook", async (req, res) => {
    const event = req.body;
    if (!event || typeof event !== "object" || !event.id || !event.event_type) {
      return res.status(400).json({ error: "Invalid PayPal webhook event." });
    }
    try {
      const verified = await paypal.verifyWebhook(req.headers, event);
      if (!verified) return res.status(400).json({ error: "PayPal webhook signature verification failed." });
      const eventType = String(event.event_type).toUpperCase();
      const resource = event.resource || {};
      if (eventType.startsWith("PAYMENT.PAYOUTS")) {
        const payoutResult = await sequelize.transaction(async (transaction) => {
          const [inserted] = await sequelize.query(
            `INSERT INTO "PayPalPayoutWebhookEvents" ("ProviderEventId", "EventType")
             VALUES (:eventId, :eventType)
             ON CONFLICT ("ProviderEventId") DO NOTHING
             RETURNING "PayPalPayoutWebhookEventId"`,
            { replacements: { eventId: String(event.id), eventType }, type: QueryTypes.SELECT, transaction },
          );
          if (!inserted) return { duplicate: true };
          const batchId = resource.payout_batch_id || resource.batch_header?.payout_batch_id || null;
          const itemId = resource.payout_item_id || resource.payout_item?.payout_item_id || null;
          const [payout] = await sequelize.query(
            `SELECT payout."CreatorPayoutId" AS id, payout."Status" AS status,
                    payout."Amount" AS amount, payout."Currency" AS currency,
                    payout."RetryCount" AS "retryCount", creator."UserId" AS "creatorUserId"
             FROM "CreatorPayouts" payout
             JOIN "CreatorProfiles" creator ON creator."CreatorProfileId" = payout."CreatorProfileId"
             WHERE (:batchId IS NOT NULL AND payout."ProviderBatchId" = :batchId)
                OR (:itemId IS NOT NULL AND payout."ProviderItemId" = :itemId)
             ORDER BY payout."CreatorPayoutId" DESC LIMIT 1 FOR UPDATE OF payout`,
            { replacements: { batchId, itemId }, type: QueryTypes.SELECT, transaction },
          );
          if (!payout) return { unmatched: true };
          const providerStatus = String(resource.transaction_status || resource.batch_status || "").toUpperCase();
          const nextStatus = eventType.endsWith(".SUCCEEDED") || providerStatus === "SUCCESS" || providerStatus === "SUCCESSFUL"
            ? "paid"
            : ["FAILED", "BLOCKED", "RETURNED", "DENIED", "UNCLAIMED"].some((value) => eventType.endsWith(`.${value}`) || providerStatus === value)
              ? "failed"
              : "processing";
          await sequelize.query(
            `UPDATE "CreatorPayouts"
             SET "Status" = :nextStatus, "ProviderStatus" = :providerStatus,
                 "TransactionReference" = COALESCE(:transactionReference, "TransactionReference"),
                 "PaidAt" = CASE WHEN :nextStatus = 'paid' THEN COALESCE("PaidAt", CURRENT_TIMESTAMP) ELSE "PaidAt" END,
                 "FailureReason" = CASE WHEN :nextStatus = 'failed' THEN :failureReason ELSE NULL END,
                 "ProviderResponse" = CAST(:providerResponse AS jsonb), "UpdatedAt" = CURRENT_TIMESTAMP
             WHERE "CreatorPayoutId" = :payoutId`,
            {
              replacements: {
                payoutId: payout.id,
                nextStatus,
                providerStatus: providerStatus || eventType,
                transactionReference: resource.transaction_id || null,
                failureReason: nextStatus === "failed" ? `PayPal payout event: ${eventType}` : null,
                providerResponse: JSON.stringify(resource),
              },
              transaction,
            },
          );
          await sequelize.query(
            `UPDATE "PayPalPayoutWebhookEvents"
             SET "CreatorPayoutId" = :payoutId WHERE "ProviderEventId" = :eventId`,
            { replacements: { payoutId: payout.id, eventId: String(event.id) }, transaction },
          );
          await writePayoutEvent({
            payoutId: payout.id,
            eventType: `paypal_webhook:${eventType.toLowerCase()}`,
            previousStatus: payout.status,
            nextStatus,
            actorUserId: null,
            details: { providerEventId: event.id, providerStatus },
            transaction,
          });
          await notifyPayoutCreator({
            userId: payout.creatorUserId,
            payoutId: payout.id,
            status: nextStatus,
            amount: payout.amount,
            currency: payout.currency,
            attempt: payout.retryCount,
            transaction,
          });
          return { processed: true, status: nextStatus };
        });
        return res.status(200).json({ received: true, ...payoutResult });
      }
      const isRefund = ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(eventType);
      const isDispute = eventType.startsWith("CUSTOMER.DISPUTE.");
      if (!isRefund && !isDispute) return res.status(200).json({ received: true, ignored: true });

      const result = await sequelize.transaction(async (transaction) => {
        let captureId;
        if (isRefund) {
          captureId = resource.id;
        } else {
          const disputed = Array.isArray(resource.disputed_transactions) ? resource.disputed_transactions[0] : null;
          captureId = disputed?.seller_transaction_id || disputed?.transaction_id;
        }
        if (!captureId) return { unmatched: true };

        const [payment] = await sequelize.query(
          `SELECT p."PaymentId" AS id, p."OrderId" AS "orderId",
                  p."Amount" AS amount, p."Currency" AS currency
           FROM "Payments" p
           WHERE p."PaymentMethod" = 'paypal'
             AND (p."ProviderResponse"->>'captureId' = :captureId
               OR p."ProviderResponse" #>> '{purchase_units,0,payments,captures,0,id}' = :captureId)
           ORDER BY p."PaymentId" DESC
           LIMIT 1 FOR UPDATE`,
          { replacements: { captureId: String(captureId) }, type: QueryTypes.SELECT, transaction },
        );
        if (!payment) return { unmatched: true };

        let providerAmount = null;
        let amountCurrency = String(payment.currency).toUpperCase();
        if (isRefund) {
          providerAmount = resource.amount?.value;
          amountCurrency = String(resource.amount?.currency_code || amountCurrency).toUpperCase();
          if (!finance.isMoneyAmount(providerAmount) || amountCurrency !== String(payment.currency).toUpperCase()) {
            return { invalid: true };
          }
        } else {
          const disputed = Array.isArray(resource.disputed_transactions) ? resource.disputed_transactions[0] : null;
          providerAmount = disputed?.gross_amount?.value || disputed?.amount?.value || String(payment.amount);
          amountCurrency = String(disputed?.gross_amount?.currency_code || disputed?.amount?.currency_code || payment.currency).toUpperCase();
          if (amountCurrency !== String(payment.currency).toUpperCase() || !finance.isMoneyAmount(providerAmount)) {
            return { invalid: true };
          }
        }

        const [inserted] = await sequelize.query(
          `INSERT INTO "PayPalPaymentWebhookEvents"
             ("ProviderEventId", "EventType", "PaymentId", "Amount", "Currency")
           VALUES (:eventId, :eventType, :paymentId, :amount, :currency)
           ON CONFLICT ("ProviderEventId") DO NOTHING
           RETURNING "PayPalPaymentWebhookEventId"`,
          {
            replacements: {
              eventId: String(event.id),
              eventType,
              paymentId: payment.id,
              amount: isRefund ? providerAmount : null,
              currency: isRefund ? amountCurrency : null,
            },
            type: QueryTypes.SELECT,
            transaction,
          },
        );
        if (!inserted) return { duplicate: true };

        if (isRefund) {
          await finance.applyPaymentAdjustment({
            paymentId: payment.id,
            adjustmentType: "refund",
            providerAmount: String(providerAmount),
            externalReference: String(event.id),
            reason: `PayPal reported ${eventType}.`,
            transaction,
          });
          const [refunds] = await sequelize.query(
            `SELECT COALESCE(SUM("Amount"), 0) AS total
             FROM "PayPalPaymentWebhookEvents"
             WHERE "PaymentId" = :paymentId
               AND "EventType" IN ('PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED')`,
            { replacements: { paymentId: payment.id }, type: QueryTypes.SELECT, transaction },
          );
          const fullyRefunded = parseCents(refunds.total) >= parseCents(payment.amount);
          const nextStatus = fullyRefunded ? "refunded" : "partially_refunded";
          await sequelize.query(
            `UPDATE "Payments" SET "Status" = :status WHERE "PaymentId" = :paymentId`,
            { replacements: { status: nextStatus, paymentId: payment.id }, transaction },
          );
          await sequelize.query(
            `UPDATE "Orders" SET "Status" = :status
             WHERE "OrderId" = :orderId AND "Status" IN ('paid', 'completed', 'partially_refunded', 'refunded')`,
            { replacements: { status: nextStatus, orderId: payment.orderId }, transaction },
          );
          return { processed: true, status: nextStatus };
        }

        const disputeId = String(resource.dispute_id || resource.id);
        if (eventType === "CUSTOMER.DISPUTE.CREATED") {
          await finance.holdEarningsForPayment({
            paymentId: payment.id,
            holdType: "dispute",
            reason: "A PayPal dispute is under review.",
            idempotencyKey: `paypal-dispute:${disputeId}`,
            transaction,
          });
          return { processed: true, status: "on_hold" };
        }
        if (eventType === "CUSTOMER.DISPUTE.RESOLVED") {
          const outcome = String(resource.dispute_outcome?.outcome_code || "").toUpperCase();
          if (outcome.includes("BUYER")) {
            await finance.applyPaymentAdjustment({
              paymentId: payment.id,
              adjustmentType: "chargeback",
              providerAmount: String(providerAmount),
              externalReference: `paypal-dispute-chargeback:${disputeId}`,
              reason: `PayPal dispute ${disputeId} was resolved in the buyer's favor.`,
              transaction,
            });
          }
          await finance.releasePaymentHolds({
            paymentId: payment.id,
            holdType: "dispute",
            idempotencyKey: `paypal-dispute:${disputeId}`,
            transaction,
          });
          return { processed: true, status: outcome.includes("BUYER") ? "chargeback" : "released" };
        }
        return { processed: true, ignored: true };
      });
      if (result.invalid) return res.status(422).json({ error: "PayPal event amount or currency did not validate." });
      return res.status(200).json({ received: true, ...result });
    } catch (error) {
      return reportFailure(res, error, "process PayPal payment webhook");
    }
  });

  return router;
};
