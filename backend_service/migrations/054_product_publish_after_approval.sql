ALTER TABLE "Products"
    ADD COLUMN IF NOT EXISTS "PublishAfterApproval" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "Products"
SET "PublishAfterApproval" = TRUE
WHERE "Status" = 'published'
   OR "ApprovalStatus" IN ('pending', 'changes_requested');
