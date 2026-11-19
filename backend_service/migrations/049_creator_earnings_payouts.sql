CREATE TABLE IF NOT EXISTS "MarketplaceFinanceSettings" (
    "FinanceSettingId" SMALLINT PRIMARY KEY DEFAULT 1 CHECK ("FinanceSettingId" = 1),
    "CommissionRate" NUMERIC(5,4) NOT NULL DEFAULT 0.2000
        CHECK ("CommissionRate" >= 0 AND "CommissionRate" <= 1),
    "MinimumPayoutAmount" NUMERIC(12,2) NOT NULL DEFAULT 100.00
        CHECK ("MinimumPayoutAmount" >= 0),
    "PayoutCurrency" CHAR(3) NOT NULL DEFAULT 'USD'
        CHECK ("PayoutCurrency" = 'USD'),
    "MonthlyPayoutDay" SMALLINT NOT NULL DEFAULT 1
        CHECK ("MonthlyPayoutDay" BETWEEN 1 AND 28),
    "AutomaticPayoutsEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "UpdatedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "MarketplaceFinanceSettings" ("FinanceSettingId")
VALUES (1)
ON CONFLICT ("FinanceSettingId") DO NOTHING;

CREATE TABLE IF NOT EXISTS "CreatorPayoutAccounts" (
    "CreatorPayoutAccountId" BIGSERIAL PRIMARY KEY,
    "CreatorProfileId" INT NOT NULL UNIQUE
        REFERENCES "CreatorProfiles"("CreatorProfileId") ON DELETE RESTRICT,
    "PayPalEmailEncrypted" TEXT NOT NULL,
    "PayPalEmailFingerprint" CHAR(64) NOT NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "CreatorEarnings" (
    "CreatorEarningId" BIGSERIAL PRIMARY KEY,
    "CreatorProfileId" INT NOT NULL
        REFERENCES "CreatorProfiles"("CreatorProfileId") ON DELETE RESTRICT,
    "OrderId" BIGINT NOT NULL
        REFERENCES "Orders"("OrderId") ON DELETE RESTRICT,
    "OrderItemId" BIGINT NOT NULL UNIQUE
        REFERENCES "OrderItems"("OrderItemId") ON DELETE RESTRICT,
    "PaymentId" BIGINT NOT NULL
        REFERENCES "Payments"("PaymentId") ON DELETE RESTRICT,
    "ProductId" INT NOT NULL
        REFERENCES "Products"("ProductId") ON DELETE RESTRICT,
    "PaymentMethod" VARCHAR(50) NOT NULL,
    "Currency" CHAR(3) NOT NULL,
    "SaleAmount" NUMERIC(12,2) NOT NULL CHECK ("SaleAmount" > 0),
    "CommissionRate" NUMERIC(5,4) NOT NULL
        CHECK ("CommissionRate" >= 0 AND "CommissionRate" <= 1),
    "MarketplaceCommission" NUMERIC(12,2) NOT NULL
        CHECK ("MarketplaceCommission" >= 0),
    "PaidAt" TIMESTAMPTZ NOT NULL,
    "EligibilityAt" TIMESTAMPTZ NOT NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CK_CreatorEarnings_ThirtyDayHold"
        CHECK ("EligibilityAt" = "PaidAt" + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS "IX_CreatorEarnings_CreatorCurrencyEligibility"
ON "CreatorEarnings" ("CreatorProfileId", "Currency", "EligibilityAt");

CREATE INDEX IF NOT EXISTS "IX_CreatorEarnings_PaymentId"
ON "CreatorEarnings" ("PaymentId");

CREATE TABLE IF NOT EXISTS "CreatorEarningAdjustments" (
    "CreatorEarningAdjustmentId" BIGSERIAL PRIMARY KEY,
    "CreatorEarningId" BIGINT NOT NULL
        REFERENCES "CreatorEarnings"("CreatorEarningId") ON DELETE RESTRICT,
    "AdjustmentType" VARCHAR(32) NOT NULL
        CHECK ("AdjustmentType" IN ('processing_fee', 'refund', 'chargeback', 'manual')),
    "Amount" NUMERIC(12,2) NOT NULL,
    "ProviderAmount" NUMERIC(12,2),
    "Currency" CHAR(3) NOT NULL,
    "IdempotencyKey" VARCHAR(255) NOT NULL UNIQUE,
    "ExternalReference" VARCHAR(255),
    "Reason" TEXT NOT NULL,
    "CreatedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CK_CreatorEarningAdjustments_Amount"
        CHECK (
            ("AdjustmentType" = 'manual')
            OR ("Amount" >= 0)
        )
);

CREATE INDEX IF NOT EXISTS "IX_CreatorEarningAdjustments_EarningId"
ON "CreatorEarningAdjustments" ("CreatorEarningId", "CreatedAt");

CREATE TABLE IF NOT EXISTS "CreatorEarningHolds" (
    "CreatorEarningHoldId" BIGSERIAL PRIMARY KEY,
    "CreatorEarningId" BIGINT NOT NULL
        REFERENCES "CreatorEarnings"("CreatorEarningId") ON DELETE RESTRICT,
    "HoldType" VARCHAR(40) NOT NULL
        CHECK ("HoldType" IN ('provider_fee_pending', 'dispute', 'manual_review')),
    "Reason" TEXT NOT NULL,
    "IdempotencyKey" VARCHAR(255) NOT NULL UNIQUE,
    "CreatedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ReleasedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "ReleasedAt" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "IX_CreatorEarningHolds_ActiveType"
ON "CreatorEarningHolds" ("CreatorEarningId", "HoldType")
WHERE "ReleasedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IX_CreatorEarningHolds_Active"
ON "CreatorEarningHolds" ("CreatorEarningId")
WHERE "ReleasedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "CreatorEarningReleaseEvents" (
    "CreatorEarningReleaseEventId" BIGSERIAL PRIMARY KEY,
    "CreatorEarningId" BIGINT NOT NULL
        REFERENCES "CreatorEarnings"("CreatorEarningId") ON DELETE RESTRICT,
    "ReleasedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE ("CreatorEarningId")
);

CREATE TABLE IF NOT EXISTS "CreatorPayoutSchedules" (
    "CreatorPayoutScheduleId" BIGSERIAL PRIMARY KEY,
    "CreatorProfileId" INT NOT NULL UNIQUE
        REFERENCES "CreatorProfiles"("CreatorProfileId") ON DELETE RESTRICT,
    "ScheduleType" VARCHAR(32) NOT NULL DEFAULT 'automatic_monthly'
        CHECK ("ScheduleType" IN ('automatic_monthly', 'every_n_days', 'monthly_day', 'custom_date', 'manual_only')),
    "IntervalDays" SMALLINT,
    "DayOfMonth" SMALLINT,
    "NextPayoutAt" TIMESTAMPTZ,
    "IsPaused" BOOLEAN NOT NULL DEFAULT FALSE,
    "UpdatedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CK_CreatorPayoutSchedules_IntervalDays"
        CHECK ("IntervalDays" IS NULL OR "IntervalDays" BETWEEN 1 AND 365),
    CONSTRAINT "CK_CreatorPayoutSchedules_DayOfMonth"
        CHECK ("DayOfMonth" IS NULL OR "DayOfMonth" BETWEEN 1 AND 28),
    CONSTRAINT "CK_CreatorPayoutSchedules_RequiredSettings"
        CHECK (
            ("ScheduleType" = 'every_n_days' AND "IntervalDays" IS NOT NULL)
            OR ("ScheduleType" = 'monthly_day' AND "DayOfMonth" IS NOT NULL)
            OR ("ScheduleType" = 'custom_date' AND "NextPayoutAt" IS NOT NULL)
            OR "ScheduleType" IN ('automatic_monthly', 'manual_only')
        )
);

CREATE TABLE IF NOT EXISTS "CreatorPayouts" (
    "CreatorPayoutId" BIGSERIAL PRIMARY KEY,
    "UUID" UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    "CreatorProfileId" INT NOT NULL
        REFERENCES "CreatorProfiles"("CreatorProfileId") ON DELETE RESTRICT,
    "CreatorPayoutScheduleId" BIGINT
        REFERENCES "CreatorPayoutSchedules"("CreatorPayoutScheduleId") ON DELETE SET NULL,
    "ScheduledFor" TIMESTAMPTZ,
    "ExecutionMode" VARCHAR(16) NOT NULL
        CHECK ("ExecutionMode" IN ('paypal', 'manual')),
    "PaymentMethod" VARCHAR(80) NOT NULL,
    "Amount" NUMERIC(12,2) NOT NULL CHECK ("Amount" > 0),
    "Currency" CHAR(3) NOT NULL DEFAULT 'USD'
        CHECK ("Currency" = 'USD'),
    "Status" VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK ("Status" IN ('draft', 'pending_approval', 'processing', 'paid', 'failed', 'cancelled')),
    "IdempotencyKey" VARCHAR(255) NOT NULL UNIQUE,
    "TransactionReference" VARCHAR(255),
    "FailureReason" TEXT,
    "ProviderBatchId" VARCHAR(255),
    "ProviderItemId" VARCHAR(255),
    "ProviderRequestId" VARCHAR(255),
    "ProviderStatus" VARCHAR(64),
    "ProviderResponse" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "RetryCount" SMALLINT NOT NULL DEFAULT 0 CHECK ("RetryCount" >= 0),
    "Notes" TEXT,
    "CreatedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "ApprovedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "ProcessedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "PaidAt" TIMESTAMPTZ,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "UX_CreatorPayouts_ScheduledRun"
ON "CreatorPayouts" ("CreatorProfileId", "ScheduledFor")
WHERE "ScheduledFor" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "IX_CreatorPayouts_StatusCreatedAt"
ON "CreatorPayouts" ("Status", "CreatedAt" DESC);

CREATE INDEX IF NOT EXISTS "IX_CreatorPayouts_CreatorCreatedAt"
ON "CreatorPayouts" ("CreatorProfileId", "CreatedAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "UX_CreatorPayouts_ProviderBatchId"
ON "CreatorPayouts" ("ProviderBatchId")
WHERE "ProviderBatchId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "CreatorPayoutItems" (
    "CreatorPayoutItemId" BIGSERIAL PRIMARY KEY,
    "CreatorPayoutId" BIGINT NOT NULL
        REFERENCES "CreatorPayouts"("CreatorPayoutId") ON DELETE RESTRICT,
    "CreatorEarningId" BIGINT NOT NULL
        REFERENCES "CreatorEarnings"("CreatorEarningId") ON DELETE RESTRICT,
    "Amount" NUMERIC(12,2) NOT NULL CHECK ("Amount" > 0),
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE ("CreatorPayoutId", "CreatorEarningId")
);

CREATE INDEX IF NOT EXISTS "IX_CreatorPayoutItems_EarningId"
ON "CreatorPayoutItems" ("CreatorEarningId");

CREATE TABLE IF NOT EXISTS "CreatorPayoutEvents" (
    "CreatorPayoutEventId" BIGSERIAL PRIMARY KEY,
    "CreatorPayoutId" BIGINT NOT NULL
        REFERENCES "CreatorPayouts"("CreatorPayoutId") ON DELETE RESTRICT,
    "EventType" VARCHAR(40) NOT NULL,
    "PreviousStatus" VARCHAR(24),
    "NextStatus" VARCHAR(24),
    "ActorUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "Details" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IX_CreatorPayoutEvents_PayoutCreatedAt"
ON "CreatorPayoutEvents" ("CreatorPayoutId", "CreatedAt");

CREATE TABLE IF NOT EXISTS "CreatorPayoutProofs" (
    "CreatorPayoutProofId" BIGSERIAL PRIMARY KEY,
    "CreatorPayoutId" BIGINT NOT NULL
        REFERENCES "CreatorPayouts"("CreatorPayoutId") ON DELETE RESTRICT,
    "FileName" VARCHAR(255) NOT NULL,
    "MimeType" VARCHAR(100) NOT NULL
        CHECK ("MimeType" IN ('application/pdf', 'image/jpeg', 'image/png')),
    "FileSize" INT NOT NULL CHECK ("FileSize" BETWEEN 1 AND 5242880),
    "Content" BYTEA NOT NULL,
    "UploadedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "PayPalPayoutWebhookEvents" (
    "PayPalPayoutWebhookEventId" BIGSERIAL PRIMARY KEY,
    "ProviderEventId" VARCHAR(255) NOT NULL UNIQUE,
    "EventType" VARCHAR(100) NOT NULL,
    "CreatorPayoutId" BIGINT REFERENCES "CreatorPayouts"("CreatorPayoutId") ON DELETE SET NULL,
    "ProcessedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "PayPalPaymentWebhookEvents" (
    "PayPalPaymentWebhookEventId" BIGSERIAL PRIMARY KEY,
    "ProviderEventId" VARCHAR(255) NOT NULL UNIQUE,
    "EventType" VARCHAR(100) NOT NULL,
    "PaymentId" BIGINT REFERENCES "Payments"("PaymentId") ON DELETE SET NULL,
    "Amount" NUMERIC(12,2),
    "Currency" CHAR(3),
    "ProcessedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

WITH paid_items AS (
    SELECT DISTINCT ON (oi."OrderItemId")
           cp."CreatorProfileId",
           o."OrderId",
           oi."OrderItemId",
           p."PaymentId",
           oi."ProductId",
           p."PaymentMethod",
           o."Currency",
           oi."TotalAmount" AS "SaleAmount",
           p."PaidAt",
           p."ProviderResponse"->'purchase_units'->0->'payments'->'captures'->0
             ->'seller_receivable_breakdown'->'paypal_fee'->>'value' AS "PayPalFeeValue",
           p."ProviderResponse"->'purchase_units'->0->'payments'->'captures'->0
             ->'seller_receivable_breakdown'->'paypal_fee'->>'currency_code' AS "PayPalFeeCurrency"
    FROM "OrderItems" oi
    JOIN "Orders" o ON o."OrderId" = oi."OrderId"
    JOIN "Storefronts" s ON s."StorefrontId" = oi."StorefrontId"
    JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
    JOIN "Payments" p ON p."OrderId" = o."OrderId"
    WHERE p."Status" = 'paid'
      AND p."PaidAt" IS NOT NULL
      AND oi."TotalAmount" > 0
    ORDER BY oi."OrderItemId", p."PaidAt", p."PaymentId"
)
INSERT INTO "CreatorEarnings"
    ("CreatorProfileId", "OrderId", "OrderItemId", "PaymentId", "ProductId",
     "PaymentMethod", "Currency", "SaleAmount", "CommissionRate",
     "MarketplaceCommission", "PaidAt", "EligibilityAt")
SELECT paid_items."CreatorProfileId",
       paid_items."OrderId",
       paid_items."OrderItemId",
       paid_items."PaymentId",
       paid_items."ProductId",
       LOWER(paid_items."PaymentMethod"),
       paid_items."Currency",
       paid_items."SaleAmount",
       settings."CommissionRate",
       ROUND(paid_items."SaleAmount" * settings."CommissionRate", 2),
       paid_items."PaidAt",
       paid_items."PaidAt" + INTERVAL '30 days'
FROM paid_items
CROSS JOIN "MarketplaceFinanceSettings" settings
WHERE settings."FinanceSettingId" = 1
ON CONFLICT ("OrderItemId") DO NOTHING;

WITH paid_items AS (
    SELECT DISTINCT ON (oi."OrderItemId")
           oi."OrderItemId",
           oi."TotalAmount" AS "SaleAmount",
           p."PaymentId",
           p."PaymentMethod",
           p."Currency",
           p."ProviderResponse"->'purchase_units'->0->'payments'->'captures'->0
             ->'seller_receivable_breakdown'->'paypal_fee'->>'value' AS "PayPalFeeValue",
           p."ProviderResponse"->'purchase_units'->0->'payments'->'captures'->0
             ->'seller_receivable_breakdown'->'paypal_fee'->>'currency_code' AS "PayPalFeeCurrency"
    FROM "OrderItems" oi
    JOIN "Payments" p ON p."OrderId" = oi."OrderId"
    WHERE p."Status" = 'paid'
      AND p."PaidAt" IS NOT NULL
      AND oi."TotalAmount" > 0
    ORDER BY oi."OrderItemId", p."PaidAt", p."PaymentId"
),
order_totals AS (
    SELECT paid_items.*,
           SUM("SaleAmount") OVER (PARTITION BY "PaymentId") AS "ItemTotal",
           ROW_NUMBER() OVER (PARTITION BY "PaymentId" ORDER BY "OrderItemId") AS "ItemNumber",
           COUNT(*) OVER (PARTITION BY "PaymentId") AS "ItemCount",
           CASE
             WHEN LOWER("PaymentMethod") = 'paypal'
               AND "PayPalFeeValue" ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'
               AND UPPER(COALESCE("PayPalFeeCurrency", "Currency")) = UPPER("Currency")
             THEN "PayPalFeeValue"::NUMERIC(12,2)
             ELSE NULL
           END AS "TotalProviderFee"
    FROM paid_items
),
fee_shares AS (
    SELECT order_totals.*,
           CASE
             WHEN "TotalProviderFee" IS NULL OR "ItemTotal" <= 0 THEN NULL
             WHEN "ItemNumber" = "ItemCount" THEN
               "TotalProviderFee" - COALESCE(
                 SUM(ROUND("TotalProviderFee" * "SaleAmount" / NULLIF("ItemTotal", 0), 2))
                   OVER (PARTITION BY "PaymentId" ORDER BY "OrderItemId"
                         ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
                 0
               )
             ELSE ROUND("TotalProviderFee" * "SaleAmount" / NULLIF("ItemTotal", 0), 2)
           END AS "AllocatedProviderFee"
    FROM order_totals
)
INSERT INTO "CreatorEarningAdjustments"
    ("CreatorEarningId", "AdjustmentType", "Amount", "ProviderAmount", "Currency",
     "IdempotencyKey", "ExternalReference", "Reason")
SELECT earning."CreatorEarningId",
       'processing_fee',
       fee_shares."AllocatedProviderFee",
       fee_shares."AllocatedProviderFee",
       fee_shares."Currency",
       'payment-fee:' || fee_shares."PaymentId" || ':' || fee_shares."OrderItemId",
       fee_shares."PaymentId"::TEXT,
       'Provider fee reported by the successful PayPal capture.'
FROM fee_shares
JOIN "CreatorEarnings" earning ON earning."OrderItemId" = fee_shares."OrderItemId"
WHERE fee_shares."AllocatedProviderFee" IS NOT NULL
ON CONFLICT ("IdempotencyKey") DO NOTHING;

INSERT INTO "CreatorEarningHolds"
    ("CreatorEarningId", "HoldType", "Reason", "IdempotencyKey")
SELECT earning."CreatorEarningId",
       'provider_fee_pending',
       'The payment provider did not return a processing fee; reconcile the fee before release.',
       'provider-fee-pending:' || earning."CreatorEarningId"
FROM "CreatorEarnings" earning
LEFT JOIN "CreatorEarningAdjustments" fee
  ON fee."CreatorEarningId" = earning."CreatorEarningId"
 AND fee."AdjustmentType" = 'processing_fee'
WHERE fee."CreatorEarningAdjustmentId" IS NULL
ON CONFLICT ("IdempotencyKey") DO NOTHING;
