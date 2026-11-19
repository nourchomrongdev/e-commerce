const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");
const finance = require("./creatorFinanceService");
const paypal = require("./paypalPayoutService");

const ADVISORY_LOCK_KEY = 82734102;

function cents(value) {
  const amount = String(value ?? "0").trim();
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole || "0") * 100n + BigInt((fraction || "").padEnd(2, "0"));
}

function money(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

async function writeEvent(payoutId, status, amount, transaction) {
  await sequelize.query(
    `INSERT INTO "CreatorPayoutEvents"
       ("CreatorPayoutId", "EventType", "NextStatus", "Details")
     VALUES (:payoutId, 'scheduled_payout_created', :status, CAST(:details AS jsonb))`,
    {
      replacements: { payoutId, status, details: JSON.stringify({ amount, currency: "USD" }) },
      transaction,
    },
  );
}

async function createDuePayouts(transaction, settings, providerConfigured) {
  const dueSchedules = await sequelize.query(
    `WITH due AS (
       SELECT schedule."CreatorPayoutScheduleId" AS "scheduleId",
              schedule."CreatorProfileId" AS "creatorId",
              CASE
                WHEN schedule."ScheduleType" = 'automatic_monthly' THEN
                  COALESCE(schedule."NextPayoutAt",
                    CASE WHEN (date_trunc('month', CURRENT_DATE)
                      + (settings."MonthlyPayoutDay" - 1) * INTERVAL '1 day')::date < CURRENT_DATE
                    THEN (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
                      + (settings."MonthlyPayoutDay" - 1) * INTERVAL '1 day')::date::timestamptz
                    ELSE (date_trunc('month', CURRENT_DATE)
                      + (settings."MonthlyPayoutDay" - 1) * INTERVAL '1 day')::date::timestamptz END)
                WHEN schedule."ScheduleType" = 'monthly_day' THEN
                  COALESCE(schedule."NextPayoutAt",
                    CASE WHEN (date_trunc('month', CURRENT_DATE)
                      + (schedule."DayOfMonth" - 1) * INTERVAL '1 day')::date < CURRENT_DATE
                    THEN (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
                      + (schedule."DayOfMonth" - 1) * INTERVAL '1 day')::date::timestamptz
                    ELSE (date_trunc('month', CURRENT_DATE)
                      + (schedule."DayOfMonth" - 1) * INTERVAL '1 day')::date::timestamptz END)
                ELSE schedule."NextPayoutAt"
              END AS "scheduledFor",
              schedule."ScheduleType", schedule."IntervalDays",
              schedule."DayOfMonth", schedule."NextPayoutAt",
              settings."MonthlyPayoutDay"
       FROM "CreatorPayoutSchedules" schedule
       CROSS JOIN "MarketplaceFinanceSettings" settings
       WHERE schedule."IsPaused" = FALSE
         AND settings."FinanceSettingId" = 1
         AND (
           (schedule."ScheduleType" = 'automatic_monthly'
             AND COALESCE(schedule."NextPayoutAt",
               (date_trunc('month', CURRENT_DATE)
                 + (settings."MonthlyPayoutDay" - 1) * INTERVAL '1 day')::date::timestamptz) <= CURRENT_TIMESTAMP)
           OR (schedule."ScheduleType" = 'monthly_day'
             AND COALESCE(schedule."NextPayoutAt",
               (date_trunc('month', CURRENT_DATE)
                 + (schedule."DayOfMonth" - 1) * INTERVAL '1 day')::date::timestamptz) <= CURRENT_TIMESTAMP)
           OR (schedule."ScheduleType" IN ('every_n_days', 'custom_date')
             AND schedule."NextPayoutAt" <= CURRENT_TIMESTAMP)
         )
       ORDER BY "scheduledFor", schedule."CreatorProfileId"
       FOR UPDATE OF schedule SKIP LOCKED
     )
     SELECT due.*, creator."AccountApprovalStatus"
     FROM due
     JOIN "CreatorProfiles" creator ON creator."CreatorProfileId" = due."creatorId"
     WHERE creator."IsActive" = TRUE AND creator."AccountApprovalStatus" = 'approved'`,
    { type: QueryTypes.SELECT, transaction },
  );

  const created = [];
  for (const schedule of dueSchedules) {
    const [creator] = await sequelize.query(
      `SELECT "CreatorProfileId" FROM "CreatorProfiles"
       WHERE "CreatorProfileId" = :creatorId FOR UPDATE`,
      { replacements: { creatorId: schedule.creatorId }, type: QueryTypes.SELECT, transaction },
    );
    if (!creator) continue;

    const [existing] = await sequelize.query(
      `SELECT "CreatorPayoutId" FROM "CreatorPayouts"
       WHERE "CreatorProfileId" = :creatorId AND "ScheduledFor" = :scheduledFor`,
      {
        replacements: { creatorId: schedule.creatorId, scheduledFor: schedule.scheduledFor },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    if (existing) continue;

    const [account] = await sequelize.query(
      `SELECT "PayPalEmailEncrypted" FROM "CreatorPayoutAccounts"
       WHERE "CreatorProfileId" = :creatorId`,
      { replacements: { creatorId: schedule.creatorId }, type: QueryTypes.SELECT, transaction },
    );
    const earnings = await sequelize.query(
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
                AS outstanding
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
      { replacements: { creatorId: schedule.creatorId }, type: QueryTypes.SELECT, transaction },
    );
    const total = earnings.reduce((sum, earning) => sum + cents(earning.outstanding), 0n);
    if (total < cents(settings.MinimumPayoutAmount)) {
      await updateSchedule(schedule, transaction);
      continue;
    }

    const executionMode = providerConfigured && account ? "paypal" : "manual";
    const status = executionMode === "paypal" && settings.AutomaticPayoutsEnabled
      ? "processing"
      : "pending_approval";
    const [payout] = await sequelize.query(
      `INSERT INTO "CreatorPayouts"
         ("CreatorProfileId", "CreatorPayoutScheduleId", "ScheduledFor",
          "ExecutionMode", "PaymentMethod", "Amount", "Currency", "Status",
          "IdempotencyKey", "CreatedByUserId", "ProcessedByUserId")
       VALUES (:creatorId, :scheduleId, :scheduledFor, :executionMode, 'PayPal',
               :amount, 'USD', :status, :idempotencyKey, NULL, NULL)
       RETURNING "CreatorPayoutId" AS id`,
      {
        replacements: {
          creatorId: schedule.creatorId,
          scheduleId: schedule.scheduleId,
          scheduledFor: schedule.scheduledFor,
          executionMode,
          amount: money(total),
          status,
          idempotencyKey: `scheduled:${schedule.creatorId}:${new Date(schedule.scheduledFor).toISOString()}`,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );

    let remaining = total;
    for (const earning of earnings) {
      const balance = cents(earning.outstanding);
      if (balance <= 0n || remaining <= 0n) continue;
      const allocation = balance < remaining ? balance : remaining;
      await sequelize.query(
        `INSERT INTO "CreatorPayoutItems" ("CreatorPayoutId", "CreatorEarningId", "Amount")
         VALUES (:payoutId, :earningId, :amount)`,
        {
          replacements: { payoutId: payout.id, earningId: earning.id, amount: money(allocation) },
          transaction,
        },
      );
      remaining -= allocation;
    }
    if (remaining !== 0n) throw new Error("Scheduled payout allocation did not match the available balance.");
    await writeEvent(payout.id, status, money(total), transaction);
    await updateSchedule(schedule, transaction);
    if (status === "processing" && account) {
      created.push({
        id: payout.id,
        creatorId: schedule.creatorId,
        amount: money(total),
        currency: "USD",
        retryCount: 0,
        encryptedEmail: account.PayPalEmailEncrypted,
      });
    }
  }
  return created;
}

async function updateSchedule(schedule, transaction) {
  let nextPayoutAt = null;
  const scheduledFor = new Date(schedule.scheduledFor);
  if (schedule.ScheduleType === "every_n_days") {
    nextPayoutAt = new Date(scheduledFor.getTime() + Number(schedule.IntervalDays) * 86_400_000);
  } else if (schedule.ScheduleType === "automatic_monthly" || schedule.ScheduleType === "monthly_day") {
    const next = new Date(scheduledFor);
    const day = schedule.ScheduleType === "automatic_monthly"
      ? Number(schedule.MonthlyPayoutDay)
      : Number(schedule.DayOfMonth);
    next.setUTCMonth(next.getUTCMonth() + 1, day);
    nextPayoutAt = next;
  }
  await sequelize.query(
    `UPDATE "CreatorPayoutSchedules"
     SET "NextPayoutAt" = :nextPayoutAt, "UpdatedAt" = CURRENT_TIMESTAMP
     WHERE "CreatorPayoutScheduleId" = :scheduleId`,
    { replacements: { nextPayoutAt, scheduleId: schedule.scheduleId }, transaction },
  );
}

async function submitPayout(payout) {
  let requestSent = false;
  try {
    const recipientEmail = finance.decryptPayPalEmail(payout.encryptedEmail);
    await sequelize.query(
      `UPDATE "CreatorPayouts"
       SET "ProviderRequestId" = :requestId, "UpdatedAt" = CURRENT_TIMESTAMP
       WHERE "CreatorPayoutId" = :payoutId AND "Status" = 'processing'`,
      { replacements: { payoutId: payout.id, requestId: `kd-payout-${payout.id}-${payout.retryCount}` } },
    );
    requestSent = true;
    const result = await paypal.createPayoutBatch({
      payoutId: payout.id,
      retryCount: payout.retryCount,
      recipientEmail,
      amount: payout.amount,
      currency: payout.currency,
    });
    if (!result.batchId) throw new Error("PayPal did not return a payout batch ID.");
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `UPDATE "CreatorPayouts"
         SET "ProviderBatchId" = :batchId, "ProviderItemId" = :itemId,
             "ProviderStatus" = :providerStatus, "ProviderResponse" = CAST(:response AS jsonb),
             "UpdatedAt" = CURRENT_TIMESTAMP
         WHERE "CreatorPayoutId" = :payoutId`,
        {
          replacements: {
            payoutId: payout.id,
            batchId: result.batchId,
            itemId: result.itemId,
            providerStatus: result.itemStatus || result.batchStatus,
            response: JSON.stringify(result.response),
          },
          transaction,
        },
      );
      await sequelize.query(
        `INSERT INTO "CreatorPayoutEvents"
           ("CreatorPayoutId", "EventType", "PreviousStatus", "NextStatus", "Details")
         VALUES (:payoutId, 'paypal_batch_created', 'processing', 'processing', CAST(:details AS jsonb))`,
        {
          replacements: {
            payoutId: payout.id,
            details: JSON.stringify({ batchId: result.batchId, itemId: result.itemId }),
          },
          transaction,
        },
      );
    });
  } catch (error) {
    console.error("Scheduled PayPal payout submission failed", {
      payoutId: payout.id,
      statusCode: error.statusCode || null,
    });
    const nextStatus = requestSent ? "processing" : "failed";
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `UPDATE "CreatorPayouts"
         SET "Status" = :nextStatus,
             "FailureReason" = :failureReason,
             "ProviderResponse" = CAST(:response AS jsonb),
             "UpdatedAt" = CURRENT_TIMESTAMP
         WHERE "CreatorPayoutId" = :payoutId AND "Status" = 'processing'`,
        {
          replacements: {
            payoutId: payout.id,
            nextStatus,
            failureReason: requestSent
              ? "PayPal submission outcome is uncertain; verify the batch before retrying."
              : "Payout account could not be decrypted; update payout settings before retrying.",
            response: JSON.stringify({ statusCode: error.statusCode || null }),
          },
          transaction,
        },
      );
      await sequelize.query(
        `INSERT INTO "CreatorPayoutEvents"
           ("CreatorPayoutId", "EventType", "PreviousStatus", "NextStatus", "Details")
         VALUES (:payoutId, :eventType, 'processing', :nextStatus, CAST(:details AS jsonb))`,
        {
          replacements: {
            payoutId: payout.id,
            eventType: requestSent ? "paypal_submission_uncertain" : "paypal_account_decryption_failed",
            nextStatus,
            details: JSON.stringify({ statusCode: error.statusCode || null }),
          },
          transaction,
        },
      );
    });
  }
}

async function runFinanceSchedulerOnce() {
  const providerStatus = paypal.getPayoutsConfigurationStatus();
  const providerConfigured = providerStatus.configured && providerStatus.webhookConfigured;
  const payouts = await sequelize.transaction(async (transaction) => {
    const [lock] = await sequelize.query(
      `SELECT pg_try_advisory_xact_lock(:lockKey) AS locked`,
      { replacements: { lockKey: ADVISORY_LOCK_KEY }, type: QueryTypes.SELECT, transaction },
    );
    if (!lock.locked) return [];

    await finance.releaseExpiredEarnings(transaction);
    const [settings] = await sequelize.query(
      `SELECT "MinimumPayoutAmount", "AutomaticPayoutsEnabled"
       FROM "MarketplaceFinanceSettings" WHERE "FinanceSettingId" = 1`,
      { type: QueryTypes.SELECT, transaction },
    );
    if (!settings) throw new Error("Marketplace finance settings are missing.");
    await sequelize.query(
      `INSERT INTO "CreatorPayoutSchedules" ("CreatorProfileId", "ScheduleType", "NextPayoutAt")
       SELECT creator."CreatorProfileId", 'automatic_monthly',
              CASE WHEN (date_trunc('month', CURRENT_DATE)
                + (settings."MonthlyPayoutDay" - 1) * INTERVAL '1 day')::date < CURRENT_DATE
              THEN (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
                + (settings."MonthlyPayoutDay" - 1) * INTERVAL '1 day')::date::timestamptz
              ELSE (date_trunc('month', CURRENT_DATE)
                + (settings."MonthlyPayoutDay" - 1) * INTERVAL '1 day')::date::timestamptz END
       FROM "CreatorProfiles" creator
       CROSS JOIN "MarketplaceFinanceSettings" settings
       WHERE creator."IsActive" = TRUE
         AND creator."AccountApprovalStatus" = 'approved'
         AND settings."FinanceSettingId" = 1
       ON CONFLICT ("CreatorProfileId") DO NOTHING`,
      { transaction },
    );
    return createDuePayouts(transaction, settings, providerConfigured);
  });

  for (const payout of payouts) await submitPayout(payout);
}

function startFinanceScheduler() {
  const run = () => {
    runFinanceSchedulerOnce().catch((error) => {
      console.error("Creator finance scheduler failed", error);
    });
  };
  const timer = setInterval(run, 60_000);
  if (typeof timer.unref === "function") timer.unref();
  run();
  return timer;
}

module.exports = { runFinanceSchedulerOnce, startFinanceScheduler };
