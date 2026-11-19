CREATE TABLE IF NOT EXISTS "BuyerWishlist" (
    "WishlistId" BIGSERIAL PRIMARY KEY,
    "UserId" INT NOT NULL
        REFERENCES "UserAccounts"("UserId")
        ON DELETE CASCADE,
    "ProductId" INT NOT NULL
        REFERENCES "Products"("ProductId")
        ON DELETE CASCADE,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UQ_BuyerWishlist_User_Product" UNIQUE ("UserId", "ProductId")
);

CREATE INDEX IF NOT EXISTS "IX_BuyerWishlist_User_CreatedAt"
ON "BuyerWishlist" ("UserId", "CreatedAt" DESC);

CREATE TABLE IF NOT EXISTS "BuyerPreferences" (
    "UserId" INT PRIMARY KEY
        REFERENCES "UserAccounts"("UserId")
        ON DELETE CASCADE,
    "EmailNotifications" BOOLEAN NOT NULL DEFAULT TRUE,
    "ProductUpdateNotifications" BOOLEAN NOT NULL DEFAULT TRUE,
    "MarketingNotifications" BOOLEAN NOT NULL DEFAULT FALSE,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
