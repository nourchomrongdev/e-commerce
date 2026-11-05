CREATE TABLE IF NOT EXISTS "LegalPolicies" (
  "PolicyId" SERIAL PRIMARY KEY,
  "PolicyKey" VARCHAR(120) NOT NULL UNIQUE,
  "Title" VARCHAR(255) NOT NULL,
  "Slug" VARCHAR(255) NOT NULL,
  "Category" VARCHAR(120) NOT NULL,
  "Description" TEXT,
  "Content" TEXT,
  "Status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "Version" INTEGER NOT NULL DEFAULT 1,
  "CreatedBy" INTEGER,
  "UpdatedBy" INTEGER,
  "CreatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "UpdatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "PublishedAt" TIMESTAMP WITH TIME ZONE,
  "DeletedAt" TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS "LegalPolicyVersions" (
  "PolicyVersionId" SERIAL PRIMARY KEY,
  "PolicyId" INTEGER NOT NULL REFERENCES "LegalPolicies" ("PolicyId") ON DELETE CASCADE,
  "VersionNumber" DOUBLE PRECISION NOT NULL,
  "Title" VARCHAR(255) NOT NULL,
  "Slug" VARCHAR(255) NOT NULL,
  "Category" VARCHAR(120) NOT NULL,
  "Description" TEXT,
  "Content" TEXT,
  "Status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "CreatedBy" INTEGER,
  "CreatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "PublishedAt" TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS "LegalPolicyAuditLogs" (
  "AuditLogId" SERIAL PRIMARY KEY,
  "PolicyId" INTEGER NOT NULL REFERENCES "LegalPolicies" ("PolicyId") ON DELETE CASCADE,
  "PolicyVersionId" INTEGER,
  "Action" VARCHAR(80) NOT NULL,
  "ActorUserId" INTEGER,
  "ActorName" VARCHAR(255),
  "Metadata" JSONB,
  "CreatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_legal_policies_status ON "LegalPolicies" ("Status");
CREATE INDEX IF NOT EXISTS idx_legal_policies_updated_at ON "LegalPolicies" ("UpdatedAt");
CREATE INDEX IF NOT EXISTS idx_legal_policy_versions_policy_id ON "LegalPolicyVersions" ("PolicyId", "VersionNumber");
CREATE INDEX IF NOT EXISTS idx_legal_policy_audit_policy_id ON "LegalPolicyAuditLogs" ("PolicyId", "CreatedAt");
