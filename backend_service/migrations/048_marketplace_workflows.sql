ALTER TABLE "CreatorProfiles"
    ADD COLUMN IF NOT EXISTS "AccountApprovalStatus" VARCHAR(20),
    ADD COLUMN IF NOT EXISTS "IdentityVerificationStatus" VARCHAR(20);

UPDATE "CreatorProfiles"
SET "AccountApprovalStatus" = CASE WHEN "IsVerified" THEN 'approved' ELSE 'pending' END
WHERE "AccountApprovalStatus" IS NULL;

UPDATE "CreatorProfiles"
SET "IdentityVerificationStatus" = 'unverified'
WHERE "IdentityVerificationStatus" IS NULL;

UPDATE "CreatorProfiles"
SET "IsVerified" = FALSE
WHERE "IdentityVerificationStatus" = 'unverified' AND "IsVerified" = TRUE;

ALTER TABLE "CreatorProfiles"
    ALTER COLUMN "AccountApprovalStatus" SET DEFAULT 'pending',
    ALTER COLUMN "AccountApprovalStatus" SET NOT NULL,
    ALTER COLUMN "IdentityVerificationStatus" SET DEFAULT 'unverified',
    ALTER COLUMN "IdentityVerificationStatus" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CK_CreatorProfiles_AccountApprovalStatus') THEN
        ALTER TABLE "CreatorProfiles" ADD CONSTRAINT "CK_CreatorProfiles_AccountApprovalStatus"
            CHECK ("AccountApprovalStatus" IN ('pending', 'approved', 'rejected', 'suspended'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CK_CreatorProfiles_IdentityVerificationStatus') THEN
        ALTER TABLE "CreatorProfiles" ADD CONSTRAINT "CK_CreatorProfiles_IdentityVerificationStatus"
            CHECK ("IdentityVerificationStatus" IN ('unverified', 'pending', 'additional_info_required', 'verified', 'rejected', 'revoked'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CreatorApplications" (
    "CreatorApplicationId" BIGSERIAL PRIMARY KEY,
    "UUID" UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    "UserId" INT NOT NULL REFERENCES "UserAccounts"("UserId") ON DELETE CASCADE,
    "FullLegalName" VARCHAR(255) NOT NULL,
    "Country" VARCHAR(100) NOT NULL,
    "BusinessOverview" TEXT NOT NULL,
    "StoreName" VARCHAR(150) NOT NULL,
    "Username" VARCHAR(100) NOT NULL,
    "PhoneNumber" VARCHAR(50),
    "WebsiteUrl" TEXT,
    "Bio" TEXT,
    "AvatarUrl" TEXT,
    "BannerUrl" TEXT,
    "SocialLinks" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK ("Status" IN ('pending', 'approved', 'rejected', 'suspended', 'withdrawn')),
    "ReviewReason" TEXT,
    "ReviewedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "SubmittedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ReviewedAt" TIMESTAMPTZ,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_CreatorApplications_Pending_User"
    ON "CreatorApplications" ("UserId") WHERE "Status" = 'pending';
CREATE INDEX IF NOT EXISTS "IX_CreatorApplications_Status_SubmittedAt"
    ON "CreatorApplications" ("Status", "SubmittedAt" DESC);

CREATE TABLE IF NOT EXISTS "CreatorApplicationEvents" (
    "CreatorApplicationEventId" BIGSERIAL PRIMARY KEY,
    "CreatorApplicationId" BIGINT NOT NULL REFERENCES "CreatorApplications"("CreatorApplicationId") ON DELETE CASCADE,
    "ActorUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "PreviousStatus" VARCHAR(20),
    "NewStatus" VARCHAR(20) NOT NULL,
    "Reason" TEXT,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IX_CreatorApplicationEvents_Application"
    ON "CreatorApplicationEvents" ("CreatorApplicationId", "CreatedAt" DESC);

CREATE TABLE IF NOT EXISTS "CreatorVerificationApplications" (
    "CreatorVerificationApplicationId" BIGSERIAL PRIMARY KEY,
    "UUID" UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    "UserId" INT NOT NULL REFERENCES "UserAccounts"("UserId") ON DELETE CASCADE,
    "FullLegalName" VARCHAR(255) NOT NULL,
    "Country" VARCHAR(100) NOT NULL,
    "DocumentType" VARCHAR(40) NOT NULL,
    "DocumentStorageKey" VARCHAR(100) NOT NULL,
    "DocumentMimeType" VARCHAR(100) NOT NULL,
    "DocumentSize" BIGINT NOT NULL CHECK ("DocumentSize" > 0),
    "Status" VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK ("Status" IN ('pending', 'additional_info_required', 'verified', 'rejected', 'revoked', 'withdrawn')),
    "ReviewReason" TEXT,
    "ReviewedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "SubmittedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ReviewedAt" TIMESTAMPTZ,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_CreatorVerificationApplications_Pending_User"
    ON "CreatorVerificationApplications" ("UserId") WHERE "Status" = 'pending';
CREATE INDEX IF NOT EXISTS "IX_CreatorVerificationApplications_Status_SubmittedAt"
    ON "CreatorVerificationApplications" ("Status", "SubmittedAt" DESC);

CREATE TABLE IF NOT EXISTS "CreatorVerificationEvents" (
    "CreatorVerificationEventId" BIGSERIAL PRIMARY KEY,
    "CreatorVerificationApplicationId" BIGINT NOT NULL
        REFERENCES "CreatorVerificationApplications"("CreatorVerificationApplicationId") ON DELETE CASCADE,
    "ActorUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "PreviousStatus" VARCHAR(20),
    "NewStatus" VARCHAR(20) NOT NULL,
    "Reason" TEXT,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IX_CreatorVerificationEvents_Application"
    ON "CreatorVerificationEvents" ("CreatorVerificationApplicationId", "CreatedAt" DESC);

ALTER TABLE "Products" ADD COLUMN IF NOT EXISTS "ApprovalStatus" VARCHAR(20);

ALTER TABLE "Products"
    ALTER COLUMN "ApprovalStatus" DROP DEFAULT,
    ALTER COLUMN "ApprovalStatus" TYPE VARCHAR(20) USING "ApprovalStatus"::text;

UPDATE "Products"
SET "ApprovalStatus" = CASE
    WHEN "Status" = 'published' THEN 'approved'
    WHEN "Status" IN ('pending', 'rejected') THEN "Status"::text
    ELSE 'draft'
END
WHERE "ApprovalStatus" IS NULL;

ALTER TABLE "Products"
    ALTER COLUMN "ApprovalStatus" SET DEFAULT 'draft',
    ALTER COLUMN "ApprovalStatus" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CK_Products_ApprovalStatus') THEN
        ALTER TABLE "Products" ADD CONSTRAINT "CK_Products_ApprovalStatus"
            CHECK ("ApprovalStatus" IN ('draft', 'pending', 'changes_requested', 'approved', 'rejected'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IX_Products_ApprovalStatus"
    ON "Products" ("ApprovalStatus", "UpdatedAt" DESC);

CREATE TABLE IF NOT EXISTS "ProductApprovalEvents" (
    "ProductApprovalEventId" BIGSERIAL PRIMARY KEY,
    "ProductId" INT NOT NULL REFERENCES "Products"("ProductId") ON DELETE CASCADE,
    "ActorUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "PreviousStatus" VARCHAR(20),
    "NewStatus" VARCHAR(20) NOT NULL,
    "Reason" TEXT,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IX_ProductApprovalEvents_Product"
    ON "ProductApprovalEvents" ("ProductId", "CreatedAt" DESC);

ALTER TYPE review_status ADD VALUE IF NOT EXISTS 'flagged';
ALTER TYPE review_status ADD VALUE IF NOT EXISTS 'removed';

CREATE TABLE IF NOT EXISTS "ReviewResponses" (
    "ReviewResponseId" BIGSERIAL PRIMARY KEY,
    "ReviewId" BIGINT NOT NULL UNIQUE REFERENCES "Reviews"("ReviewId") ON DELETE CASCADE,
    "CreatorProfileId" INT NOT NULL REFERENCES "CreatorProfiles"("CreatorProfileId") ON DELETE CASCADE,
    "Response" TEXT NOT NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CK_ReviewResponses_NotBlank" CHECK (btrim("Response") <> '')
);

CREATE TABLE IF NOT EXISTS "ReviewModerationEvents" (
    "ReviewModerationEventId" BIGSERIAL PRIMARY KEY,
    "ReviewId" BIGINT NOT NULL REFERENCES "Reviews"("ReviewId") ON DELETE CASCADE,
    "ActorUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "PreviousStatus" VARCHAR(20),
    "NewStatus" VARCHAR(20) NOT NULL,
    "Reason" TEXT,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IX_ReviewModerationEvents_Review"
    ON "ReviewModerationEvents" ("ReviewId", "CreatedAt" DESC);

CREATE TABLE IF NOT EXISTS "ReviewReports" (
    "ReviewReportId" BIGSERIAL PRIMARY KEY,
    "ReviewId" BIGINT NOT NULL REFERENCES "Reviews"("ReviewId") ON DELETE CASCADE,
    "ReporterUserId" INT NOT NULL REFERENCES "UserAccounts"("UserId") ON DELETE CASCADE,
    "Reason" VARCHAR(40) NOT NULL,
    "Details" TEXT,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK ("Status" IN ('pending', 'dismissed', 'actioned')),
    "DecisionReason" TEXT,
    "ReviewedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UQ_ReviewReports_Review_Reporter" UNIQUE ("ReviewId", "ReporterUserId"),
    CONSTRAINT "CK_ReviewReports_Reason" CHECK (
        "Reason" IN ('spam', 'offensive', 'false_information', 'other')
    ),
    CONSTRAINT "CK_ReviewReports_Details_NotBlank" CHECK (
        "Details" IS NULL OR btrim("Details") <> ''
    )
);

CREATE INDEX IF NOT EXISTS "IX_ReviewReports_Status_Created"
    ON "ReviewReports" ("Status", "CreatedAt" DESC);
