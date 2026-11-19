const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");
const { sendToUser } = require("./pushNotificationService");

function normalizeHref(href) {
  if (href === null || href === undefined || href === "") return null;
  const value = String(href).trim();
  if (value.length > 500 || !value.startsWith("/")) {
    throw new Error("Notification links must be relative paths within the marketplace.");
  }
  const parsed = new URL(value, "https://marketplace.invalid");
  if (parsed.origin !== "https://marketplace.invalid") {
    throw new Error("Notification links must be relative paths within the marketplace.");
  }
  return value;
}

async function createNotification(userId, notification, options = {}) {
  const recipientId = Number(userId);
  const type = String(notification?.type || "").trim();
  const title = String(notification?.title || "").trim();
  const message = String(notification?.message || "").trim();
  const relatedEntityType = notification?.relatedEntityType ? String(notification.relatedEntityType).trim().slice(0, 40) : null;
  const relatedEntityId = notification?.relatedEntityId === null || notification?.relatedEntityId === undefined
    ? null
    : String(notification.relatedEntityId).trim().slice(0, 100);
  const dedupeKey = notification?.dedupeKey ? String(notification.dedupeKey).trim().slice(0, 180) : null;
  const href = normalizeHref(notification?.href);

  if (!Number.isSafeInteger(recipientId) || recipientId <= 0) throw new Error("A valid notification recipient is required.");
  if (!type || type.length > 80 || !title || title.length > 180 || !message || message.length > 5000) {
    throw new Error("Notification type, title, and message are required and must be within their size limits.");
  }

  const [created] = await sequelize.query(
    `INSERT INTO "Notifications"
       ("UserId", "Type", "Title", "Message", "RelatedEntityType", "RelatedEntityId", "Href", "DedupeKey")
     VALUES
       (:userId, :type, :title, :message, :relatedEntityType, :relatedEntityId, :href, :dedupeKey)
     ON CONFLICT DO NOTHING
     RETURNING "NotificationId" AS id`,
    {
      replacements: { userId: recipientId, type, title, message, relatedEntityType, relatedEntityId, href, dedupeKey },
      type: QueryTypes.SELECT,
      transaction: options.transaction,
    },
  );
  if (!created) return null;

  const notificationForPush = { id: String(created.id), title, message, href };
  const deliverPush = () => {
    void sendToUser(recipientId, notificationForPush).catch((error) => {
      console.error("Web Push notification dispatch failed.", {
        userId: recipientId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };
  if (options.transaction) options.transaction.afterCommit(deliverPush);
  else deliverPush();

  return created;
}

async function notifyRoles(roleNames, notification, options = {}) {
  const roles = [...new Set((Array.isArray(roleNames) ? roleNames : [roleNames])
    .map((role) => String(role || "").trim().toLowerCase())
    .filter(Boolean))];
  if (!roles.length) return 0;

  const recipients = await sequelize.query(
    `SELECT DISTINCT account."UserId" AS id
     FROM "UserAccountRoles" account_role
     JOIN "UsersRoles" role ON role."UserRoleId" = account_role."UserRoleId"
     JOIN "UserAccounts" account ON account."UserId" = account_role."UserId"
     WHERE LOWER(role."RoleName") IN (:roles)
       AND account."Status" = 'active'`,
    {
      replacements: { roles },
      type: QueryTypes.SELECT,
      transaction: options.transaction,
    },
  );
  const excluded = new Set((options.excludeUserIds || []).map(Number));
  const created = await Promise.all(
    recipients
      .filter((recipient) => !excluded.has(Number(recipient.id)))
      .map((recipient) => createNotification(recipient.id, notification, options)),
  );
  return created.filter(Boolean).length;
}

module.exports = { createNotification, notifyRoles };
