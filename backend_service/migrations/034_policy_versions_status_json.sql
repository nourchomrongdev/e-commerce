ALTER TABLE "LegalPolicies"
  ADD COLUMN IF NOT EXISTS "ContentJson" JSONB,
  ADD COLUMN IF NOT EXISTS "PublishedVersion" INTEGER;

ALTER TABLE "LegalPolicies"
  ALTER COLUMN "Version" TYPE DOUBLE PRECISION USING "Version"::DOUBLE PRECISION,
  ALTER COLUMN "PublishedVersion" TYPE DOUBLE PRECISION USING "PublishedVersion"::DOUBLE PRECISION;

ALTER TABLE "LegalPolicyVersions"
  ADD COLUMN IF NOT EXISTS "ContentJson" JSONB,
  ADD COLUMN IF NOT EXISTS "UpdatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'legal_policies_status_check'
  ) THEN
    ALTER TABLE "LegalPolicies"
      ADD CONSTRAINT legal_policies_status_check CHECK ("Status" IN ('draft', 'published', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'legal_policy_versions_status_check'
  ) THEN
    ALTER TABLE "LegalPolicyVersions"
      ADD CONSTRAINT legal_policy_versions_status_check CHECK ("Status" IN ('draft', 'published', 'archived'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_policy_versions_policy_version
  ON "LegalPolicyVersions" ("PolicyId", "VersionNumber");
CREATE INDEX IF NOT EXISTS idx_legal_policy_versions_status
  ON "LegalPolicyVersions" ("PolicyId", "Status", "PublishedAt" DESC);

INSERT INTO "LegalPolicies" (
  "PolicyKey", "Title", "Slug", "Category", "Description", "Content", "Status",
  "Version", "CreatedBy", "UpdatedBy", "CreatedAt", "UpdatedAt", "PublishedAt"
)
VALUES
  ('privacy', 'Privacy Policy', 'privacy-policy', 'privacy', 'How we collect, protect, and use personal information.', '<h2>What we collect</h2><p>We collect information needed to create and operate accounts, process purchases, deliver files, provide support, and manage creator applications.</p>', 'published', 1, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('terms', 'Terms & Conditions', 'terms-and-conditions', 'terms', 'The agreement governing marketplace use.', '<h2>Using the marketplace</h2><p>Users must use the marketplace lawfully, provide accurate account information, and keep credentials secure.</p>', 'published', 1, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('refunds', 'Refund Policy', 'refund-policy', 'refunds', 'How refund requests are reviewed and resolved.', '<h2>Digital products</h2><p>Refund eligibility depends on the product licence, reason for the request, applicable consumer law, and whether the file has been accessed or downloaded.</p>', 'published', 1, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cookies', 'Cookies Policy', 'cookies-policy', 'cookies', 'How browser storage and consent are managed.', '<h2>Necessary storage</h2><p>Necessary browser storage may support sign-in state, security, preferences, and shopping features.</p>', 'published', 1, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('acceptable-use', 'Acceptable Use Policy', 'acceptable-use-policy', 'acceptable-use', 'Rules for lawful and responsible platform use.', '<h2>Allowed use</h2><p>Use the marketplace to discover, sell, purchase, and manage lawful digital products and related services.</p>', 'published', 1, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("PolicyKey") DO NOTHING;

INSERT INTO "LegalPolicyVersions" (
  "PolicyId", "VersionNumber", "Title", "Slug", "Category", "Description",
  "Content", "Status", "CreatedBy", "CreatedAt", "PublishedAt"
)
SELECT
  policy."PolicyId", policy."Version", policy."Title", policy."Slug", policy."Category",
  policy."Description", policy."Content", 'published', 1, policy."CreatedAt", policy."PublishedAt"
FROM "LegalPolicies" policy
WHERE policy."PolicyKey" IN ('privacy', 'terms', 'refunds', 'cookies', 'acceptable-use')
ON CONFLICT ("PolicyId", "VersionNumber") DO NOTHING;
