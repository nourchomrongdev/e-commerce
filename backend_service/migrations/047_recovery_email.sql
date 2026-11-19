ALTER TABLE "UserAccounts"
    ADD COLUMN IF NOT EXISTS "RecoveryEmail" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "RecoveryEmailVerifiedAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "RecoveryEmailPending" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "RecoveryEmailVerificationOtpHash" VARCHAR(64),
    ADD COLUMN IF NOT EXISTS "RecoveryEmailVerificationOtpExpiresAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "RecoveryEmailVerificationOtpRequestedAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "RecoveryEmailVerificationAttempts" SMALLINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "UX_UserAccounts_RecoveryEmail_Verified"
ON "UserAccounts" (LOWER("RecoveryEmail"))
WHERE "RecoveryEmailVerifiedAt" IS NOT NULL AND "RecoveryEmail" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "UX_UserAccounts_RecoveryEmail_Pending"
ON "UserAccounts" (LOWER("RecoveryEmailPending"))
WHERE "RecoveryEmailPending" IS NOT NULL;
