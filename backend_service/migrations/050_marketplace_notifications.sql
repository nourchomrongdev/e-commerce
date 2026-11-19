CREATE TABLE IF NOT EXISTS "Notifications" (
    "NotificationId" BIGSERIAL PRIMARY KEY,
    "UserId" INT NOT NULL
        REFERENCES "UserAccounts"("UserId") ON DELETE CASCADE,
    "Type" VARCHAR(80) NOT NULL,
    "Title" VARCHAR(180) NOT NULL,
    "Message" TEXT NOT NULL,
    "RelatedEntityType" VARCHAR(40),
    "RelatedEntityId" VARCHAR(100),
    "Href" VARCHAR(500),
    "DedupeKey" VARCHAR(180),
    "IsRead" BOOLEAN NOT NULL DEFAULT FALSE,
    "ReadAt" TIMESTAMPTZ,
    "DismissedAt" TIMESTAMPTZ,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CK_Notifications_Type_NotBlank" CHECK (btrim("Type") <> ''),
    CONSTRAINT "CK_Notifications_Title_NotBlank" CHECK (btrim("Title") <> ''),
    CONSTRAINT "CK_Notifications_Message_NotBlank" CHECK (btrim("Message") <> ''),
    CONSTRAINT "CK_Notifications_ReadAt" CHECK ("IsRead" OR "ReadAt" IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_Notifications_User_DedupeKey"
    ON "Notifications" ("UserId", "DedupeKey")
    WHERE "DedupeKey" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "IX_Notifications_User_CreatedAt"
    ON "Notifications" ("UserId", "CreatedAt" DESC, "NotificationId" DESC)
    WHERE "DismissedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "IX_Notifications_User_Unread"
    ON "Notifications" ("UserId", "NotificationId" DESC)
    WHERE "IsRead" = FALSE AND "DismissedAt" IS NULL;
