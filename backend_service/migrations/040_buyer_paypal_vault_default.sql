ALTER TABLE "BuyerPayPalVaultMethods"
ADD COLUMN IF NOT EXISTS "IsDefault" BOOLEAN NOT NULL DEFAULT FALSE;

WITH ranked_methods AS (
    SELECT "BuyerPayPalVaultMethodId",
           ROW_NUMBER() OVER (
               PARTITION BY "UserId"
               ORDER BY "CreatedAt" DESC, "BuyerPayPalVaultMethodId" DESC
           ) AS position
    FROM "BuyerPayPalVaultMethods"
)
UPDATE "BuyerPayPalVaultMethods" AS methods
SET "IsDefault" = TRUE
FROM ranked_methods
WHERE methods."BuyerPayPalVaultMethodId" = ranked_methods."BuyerPayPalVaultMethodId"
  AND ranked_methods.position = 1
  AND NOT EXISTS (
      SELECT 1
      FROM "BuyerPayPalVaultMethods" AS existing_default
      WHERE existing_default."UserId" = methods."UserId"
        AND existing_default."IsDefault" = TRUE
  );

CREATE UNIQUE INDEX IF NOT EXISTS "UX_BuyerPayPalVaultMethods_DefaultPerUser"
ON "BuyerPayPalVaultMethods" ("UserId")
WHERE "IsDefault" = TRUE;
