const express = require("express");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");
const pushNotifications = require("../services/pushNotificationService");

function validNotificationId(value) {
  const id = String(value || "").trim();
  if (!/^\d{1,19}$/.test(id)) return null;
  return BigInt(id) <= 9223372036854775807n ? id : null;
}

module.exports = function createNotificationRoutes({ requireUser }) {
  const router = express.Router();

  router.get("/notifications/push/config", requireUser, (_req, res) => {
    return res.json({
      enabled: pushNotifications.isConfigured(),
      publicKey: pushNotifications.publicKey(),
    });
  });

  router.put("/notifications/push/subscription", requireUser, async (req, res) => {
    try {
      await pushNotifications.saveSubscription(req.userId, req.body?.subscription);
      return res.status(204).end();
    } catch (error) {
      if (Number(error.statusCode) >= 400 && Number(error.statusCode) < 500) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Push subscription save failed", error);
      return res.status(500).json({ error: "Unable to enable browser push notifications." });
    }
  });

  router.delete("/notifications/push/subscription", requireUser, async (req, res) => {
    try {
      await pushNotifications.removeSubscription(req.userId, req.body?.endpoint);
      return res.status(204).end();
    } catch (error) {
      if (Number(error.statusCode) >= 400 && Number(error.statusCode) < 500) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Push subscription removal failed", error);
      return res.status(500).json({ error: "Unable to disable browser push notifications." });
    }
  });

  router.get("/notifications", requireUser, async (req, res) => {
    const requestedLimit = Number.parseInt(String(req.query.limit || "20"), 10);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 20;
    const beforeId = req.query.beforeId === undefined ? null : validNotificationId(req.query.beforeId);
    if (req.query.beforeId !== undefined && !beforeId) {
      return res.status(400).json({ error: "A valid notification cursor is required." });
    }
    const status = String(req.query.status || "all").trim().toLowerCase();
    if (!["all", "read", "unread"].includes(status)) {
      return res.status(400).json({ error: "Notification status must be all, read, or unread." });
    }
    const search = String(req.query.search || "").trim().slice(0, 200);
    const conditions = ['"UserId" = :userId', '"DismissedAt" IS NULL'];
    const replacements: { [key: string]: string | number | boolean | null } = { userId: req.userId, limit, beforeId };
    if (status !== "all") {
      conditions.push('"IsRead" = :isRead');
      replacements.isRead = status === "read";
    }
    if (search) {
      conditions.push('("Title" ILIKE :search OR "Message" ILIKE :search OR "Type" ILIKE :search OR COALESCE("RelatedEntityType", \'\') ILIKE :search OR COALESCE("RelatedEntityId", \'\') ILIKE :search)');
      replacements.search = `%${search}%`;
    }
    const filteredWhere = conditions.join(" AND ");

    try {
      const [countRows, notifications] = await Promise.all([
        sequelize.query(
          `SELECT COUNT(*)::int AS total
           FROM "Notifications"
           WHERE ${filteredWhere}`,
          { replacements, type: QueryTypes.SELECT },
        ),
        sequelize.query(
        `SELECT "NotificationId"::text AS id, "Type" AS type, "Title" AS title,
                "Message" AS message, "RelatedEntityType" AS "relatedEntityType",
                "RelatedEntityId" AS "relatedEntityId", "Href" AS href,
                "IsRead" AS "isRead", "ReadAt" AS "readAt", "CreatedAt" AS "createdAt"
         FROM "Notifications"
         WHERE ${filteredWhere}
           AND (:beforeId IS NULL OR "NotificationId" < CAST(:beforeId AS BIGINT))
         ORDER BY "NotificationId" DESC
         LIMIT :limit`,
          { replacements, type: QueryTypes.SELECT },
        ),
      ]);
      return res.json({
        notifications,
        nextCursor: notifications.length === limit ? notifications[notifications.length - 1].id : null,
        total: Number(countRows[0]?.total || 0),
      });
    } catch (error) {
      console.error("Notification list load failed", error);
      return res.status(500).json({ error: "Unable to load notifications." });
    }
  });

  router.get("/notifications/unread-count", requireUser, async (req, res) => {
    try {
      const [row] = await sequelize.query(
        `SELECT COUNT(*)::int AS count
         FROM "Notifications"
         WHERE "UserId" = :userId AND "IsRead" = FALSE AND "DismissedAt" IS NULL`,
        { replacements: { userId: req.userId }, type: QueryTypes.SELECT },
      );
      return res.json({ count: Number(row.count || 0) });
    } catch (error) {
      console.error("Notification unread count load failed", error);
      return res.status(500).json({ error: "Unable to load unread notification count." });
    }
  });

  router.patch("/notifications/read-all", requireUser, async (req, res) => {
    try {
      const updated = await sequelize.query(
        `UPDATE "Notifications"
         SET "IsRead" = TRUE, "ReadAt" = CURRENT_TIMESTAMP
         WHERE "UserId" = :userId AND "IsRead" = FALSE AND "DismissedAt" IS NULL
         RETURNING "NotificationId"`,
        { replacements: { userId: req.userId }, type: QueryTypes.SELECT },
      );
      return res.json({ updated: updated.length });
    } catch (error) {
      console.error("Mark all notifications read failed", error);
      return res.status(500).json({ error: "Unable to mark notifications as read." });
    }
  });

  router.patch("/notifications/:notificationId/read", requireUser, async (req, res) => {
    const notificationId = validNotificationId(req.params.notificationId);
    if (!notificationId) return res.status(400).json({ error: "A valid notification ID is required." });
    try {
      const [notification] = await sequelize.query(
        `UPDATE "Notifications"
         SET "IsRead" = TRUE, "ReadAt" = COALESCE("ReadAt", CURRENT_TIMESTAMP)
         WHERE "NotificationId" = :notificationId
           AND "UserId" = :userId AND "DismissedAt" IS NULL
         RETURNING "NotificationId"::text AS id, "IsRead" AS "isRead", "ReadAt" AS "readAt"`,
        { replacements: { notificationId, userId: req.userId }, type: QueryTypes.SELECT },
      );
      if (!notification) return res.status(404).json({ error: "Notification not found." });
      return res.json({ notification });
    } catch (error) {
      console.error("Mark notification read failed", error);
      return res.status(500).json({ error: "Unable to mark notification as read." });
    }
  });

  router.delete("/notifications/:notificationId", requireUser, async (req, res) => {
    const notificationId = validNotificationId(req.params.notificationId);
    if (!notificationId) return res.status(400).json({ error: "A valid notification ID is required." });
    try {
      const [notification] = await sequelize.query(
        `UPDATE "Notifications"
         SET "DismissedAt" = COALESCE("DismissedAt", CURRENT_TIMESTAMP)
         WHERE "NotificationId" = :notificationId
           AND "UserId" = :userId AND "DismissedAt" IS NULL
         RETURNING "NotificationId"::text AS id`,
        { replacements: { notificationId, userId: req.userId }, type: QueryTypes.SELECT },
      );
      if (!notification) return res.status(404).json({ error: "Notification not found." });
      return res.json({ dismissed: true });
    } catch (error) {
      console.error("Dismiss notification failed", error);
      return res.status(500).json({ error: "Unable to dismiss notification." });
    }
  });

  router.delete("/notifications", requireUser, async (req, res) => {
    try {
      const dismissed = await sequelize.query(
        `UPDATE "Notifications"
         SET "DismissedAt" = COALESCE("DismissedAt", CURRENT_TIMESTAMP)
         WHERE "UserId" = :userId AND "DismissedAt" IS NULL
         RETURNING "NotificationId"`,
        { replacements: { userId: req.userId }, type: QueryTypes.SELECT },
      );
      return res.json({ dismissed: dismissed.length });
    } catch (error) {
      console.error("Dismiss all notifications failed", error);
      return res.status(500).json({ error: "Unable to dismiss notifications." });
    }
  });

  return router;
};
