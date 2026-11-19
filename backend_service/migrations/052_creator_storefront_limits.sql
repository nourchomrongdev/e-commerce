CREATE TABLE IF NOT EXISTS "MarketplaceConfigurationSettings" (
    "SettingsId" SMALLINT PRIMARY KEY DEFAULT 1 CHECK ("SettingsId" = 1),
    "MaximumStorefrontsPerCreator" INTEGER NOT NULL DEFAULT 3
        CHECK ("MaximumStorefrontsPerCreator" BETWEEN 1 AND 50),
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "MarketplaceConfigurationSettings" ("SettingsId", "MaximumStorefrontsPerCreator")
VALUES (1, 3)
ON CONFLICT ("SettingsId") DO NOTHING;
