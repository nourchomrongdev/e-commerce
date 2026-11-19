ALTER TABLE "UserAccounts"
    ADD COLUMN IF NOT EXISTS "EmailVerifiedAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "EmailVerificationOtpHash" VARCHAR(64),
    ADD COLUMN IF NOT EXISTS "EmailVerificationOtpExpiresAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "EmailVerificationOtpRequestedAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "EmailVerificationAttempts" SMALLINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "IX_UserAccounts_EmailVerificationOtpExpiresAt"
ON "UserAccounts" ("EmailVerificationOtpExpiresAt")
WHERE "EmailVerificationOtpHash" IS NOT NULL;
