ALTER TABLE "LicenseTypes"
    ADD COLUMN IF NOT EXISTS "UsageRights" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "Restrictions" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "RequiresKey" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "ProductVersionLicenses"
    ADD COLUMN IF NOT EXISTS "LicenseTerms" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "RequiresKey" BOOLEAN;

ALTER TABLE "OrderItems"
    ADD COLUMN IF NOT EXISTS "LicenseTypeId" INT
        REFERENCES "LicenseTypes"("LicenseTypeId") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "ProductVersionId" BIGINT
        REFERENCES "ProductVersions"("ProductVersionId") ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "LicenseTermsSnapshot" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Licenses"
    ADD COLUMN IF NOT EXISTS "LicenseOrdinal" INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS "TermsSnapshot" TEXT NOT NULL DEFAULT '';

WITH numbered_licenses AS (
    SELECT "LicenseId",
           ROW_NUMBER() OVER (
               PARTITION BY "OrderItemId"
               ORDER BY "LicenseId"
           ) AS ordinal
    FROM "Licenses"
    WHERE "OrderItemId" IS NOT NULL
)
UPDATE "Licenses" AS license
SET "LicenseOrdinal" = numbered_licenses.ordinal
FROM numbered_licenses
WHERE numbered_licenses."LicenseId" = license."LicenseId";

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_Licenses_OrderItem_Ordinal"
    ON "Licenses" ("OrderItemId", "LicenseOrdinal")
    WHERE "OrderItemId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "LicenseAuditEvents" (
    "LicenseAuditEventId" BIGSERIAL PRIMARY KEY,
    "LicenseId" BIGINT NOT NULL REFERENCES "Licenses"("LicenseId") ON DELETE RESTRICT,
    "ActorUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "Action" VARCHAR(60) NOT NULL,
    "Details" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IX_LicenseAuditEvents_License_Created"
    ON "LicenseAuditEvents" ("LicenseId", "CreatedAt" DESC);

CREATE TABLE IF NOT EXISTS "LicenseValidationLogs" (
    "LicenseValidationLogId" BIGSERIAL PRIMARY KEY,
    "LicenseId" BIGINT REFERENCES "Licenses"("LicenseId") ON DELETE SET NULL,
    "KeyHash" VARCHAR(64) NOT NULL,
    "DeviceIdentifierHash" VARCHAR(64),
    "IsValid" BOOLEAN NOT NULL,
    "Reason" VARCHAR(40) NOT NULL,
    "IPAddress" INET,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IX_LicenseValidationLogs_License_Created"
    ON "LicenseValidationLogs" ("LicenseId", "CreatedAt" DESC);

CREATE TABLE IF NOT EXISTS "LicenseRevocations" (
    "LicenseRevocationId" BIGSERIAL PRIMARY KEY,
    "LicenseId" BIGINT NOT NULL REFERENCES "Licenses"("LicenseId") ON DELETE RESTRICT,
    "ActorUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "Reason" TEXT NOT NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "DRMPolicies" (
    "DRMPolicyId" SMALLINT PRIMARY KEY DEFAULT 1 CHECK ("DRMPolicyId" = 1),
    "RevokeOnRefund" BOOLEAN NOT NULL DEFAULT TRUE,
    "DisableActivationsOnRefund" BOOLEAN NOT NULL DEFAULT TRUE,
    "UpdatedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "DRMPolicies" ("DRMPolicyId") VALUES (1)
ON CONFLICT ("DRMPolicyId") DO NOTHING;

CREATE TABLE IF NOT EXISTS "DMCACases" (
    "DMCACaseId" BIGSERIAL PRIMARY KEY,
    "UUID" UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    "ProductId" INT REFERENCES "Products"("ProductId") ON DELETE SET NULL,
    "ReporterUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "CreatorUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "ReviewerUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "ReporterName" VARCHAR(255) NOT NULL,
    "ReporterEmail" VARCHAR(320) NOT NULL,
    "OriginalWork" TEXT NOT NULL,
    "InfringementDetails" TEXT NOT NULL,
    "GoodFaithDeclaration" TEXT NOT NULL,
    "LegalDeclaration" TEXT NOT NULL,
    "Status" VARCHAR(40) NOT NULL DEFAULT 'Submitted',
    "ProductStatusBeforeTakedown" VARCHAR(40),
    "RestorationNotBefore" TIMESTAMPTZ,
    "RequestedInformation" TEXT,
    "ResolutionReason" TEXT,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CK_DMCACases_Status" CHECK ("Status" IN (
        'Submitted', 'Under Review', 'Additional Information Required',
        'Approved', 'Rejected', 'Takedown Requested', 'Content Disabled',
        'Counter-Notice Submitted', 'Restoration Pending', 'Restored', 'Closed'
    ))
);

CREATE INDEX IF NOT EXISTS "IX_DMCACases_Product_Status"
    ON "DMCACases" ("ProductId", "Status");
CREATE INDEX IF NOT EXISTS "IX_DMCACases_Creator_Created"
    ON "DMCACases" ("CreatorUserId", "CreatedAt" DESC);
CREATE INDEX IF NOT EXISTS "IX_DMCACases_Reporter_Created"
    ON "DMCACases" ("ReporterUserId", "CreatedAt" DESC);

CREATE TABLE IF NOT EXISTS "DMCAEvidence" (
    "DMCAEvidenceId" BIGSERIAL PRIMARY KEY,
    "DMCACaseId" BIGINT NOT NULL REFERENCES "DMCACases"("DMCACaseId") ON DELETE RESTRICT,
    "UploadedByUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "StorageKey" VARCHAR(255) NOT NULL UNIQUE,
    "OriginalName" VARCHAR(255) NOT NULL,
    "MimeType" VARCHAR(100) NOT NULL,
    "FileSize" BIGINT NOT NULL CHECK ("FileSize" > 0),
    "Sha256" VARCHAR(64) NOT NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "DMCANotifications" (
    "DMCANotificationId" BIGSERIAL PRIMARY KEY,
    "DMCACaseId" BIGINT NOT NULL REFERENCES "DMCACases"("DMCACaseId") ON DELETE RESTRICT,
    "RecipientUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "RecipientEmail" VARCHAR(320),
    "Message" TEXT NOT NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "DMCACounterNotices" (
    "DMCACounterNoticeId" BIGSERIAL PRIMARY KEY,
    "DMCACaseId" BIGINT NOT NULL REFERENCES "DMCACases"("DMCACaseId") ON DELETE RESTRICT,
    "SubmittedByUserId" INT NOT NULL REFERENCES "UserAccounts"("UserId") ON DELETE RESTRICT,
    "Statement" TEXT NOT NULL,
    "LegalDeclaration" TEXT NOT NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "DMCAStatusHistory" (
    "DMCAStatusHistoryId" BIGSERIAL PRIMARY KEY,
    "DMCACaseId" BIGINT NOT NULL REFERENCES "DMCACases"("DMCACaseId") ON DELETE RESTRICT,
    "ActorUserId" INT REFERENCES "UserAccounts"("UserId") ON DELETE SET NULL,
    "PreviousStatus" VARCHAR(40),
    "NewStatus" VARCHAR(40) NOT NULL,
    "Reason" TEXT NOT NULL DEFAULT '',
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IX_DMCAStatusHistory_Case_Created"
    ON "DMCAStatusHistory" ("DMCACaseId", "CreatedAt");

INSERT INTO "LicenseTypes" ("LicenseName", "Description", "IsActive")
VALUES
    ('personal', 'Personal use only.', TRUE),
    ('commercial', 'Commercial use subject to the license terms.', TRUE),
    ('extended commercial', 'Extended commercial use subject to the license terms.', TRUE)
ON CONFLICT ("LicenseName") DO NOTHING;
