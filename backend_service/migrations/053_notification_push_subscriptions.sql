CREATE TABLE IF NOT EXISTS "NotificationPushSubscriptions" (
    "PushSubscriptionId" BIGSERIAL PRIMARY KEY,
    "UserId" INT NOT NULL
        REFERENCES "UserAccounts"("UserId") ON DELETE CASCADE,
    "Endpoint" TEXT NOT NULL,
    "EndpointHash" CHAR(64) NOT NULL UNIQUE,
    "KeysP256dh" VARCHAR(256) NOT NULL,
    "KeysAuth" VARCHAR(128) NOT NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IX_NotificationPushSubscriptions_UserId"
    ON "NotificationPushSubscriptions" ("UserId");
