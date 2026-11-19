CREATE TABLE IF NOT EXISTS "BuyerPayPalVaultMethods" (
    "BuyerPayPalVaultMethodId" BIGSERIAL PRIMARY KEY,
    "UserId" INT NOT NULL
        REFERENCES "UserAccounts"("UserId")
        ON DELETE CASCADE,
    "PayPalVaultTokenEncrypted" TEXT NOT NULL,
    "PayPalVaultTokenFingerprint" CHAR(64) NOT NULL UNIQUE,
    "PayPalCustomerId" VARCHAR(255),
    "CardBrand" VARCHAR(50),
    "LastDigits" CHAR(4),
    "ExpiryMonth" SMALLINT,
    "ExpiryYear" SMALLINT,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CK_BuyerPayPalVaultMethods_ExpiryMonth"
        CHECK ("ExpiryMonth" IS NULL OR "ExpiryMonth" BETWEEN 1 AND 12),
    CONSTRAINT "CK_BuyerPayPalVaultMethods_LastDigits"
        CHECK ("LastDigits" IS NULL OR "LastDigits" ~ '^[0-9]{4}$')
);

CREATE INDEX IF NOT EXISTS "IX_BuyerPayPalVaultMethods_UserId"
ON "BuyerPayPalVaultMethods" ("UserId");
