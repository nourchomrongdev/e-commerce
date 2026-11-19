const { sequelize } = require("../models");

const sensitiveKeyPattern = /password|token|secret|authorization|credential|card|licensekey|privatekey/i;

function redactSensitiveValues(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKeyPattern.test(key))
      .map(([key, nestedValue]) => [key, redactSensitiveValues(nestedValue)]),
  );
}

async function writeActivityLog({
  userId,
  action,
  entityType,
  entityId,
  description,
  ipAddress,
  userAgent,
  metadata = {},
}, transaction) {
  if (!userId || !String(action || "").trim()) {
    throw new Error("An authenticated actor and activity action are required.");
  }
  await sequelize.query(
    `INSERT INTO "ActivityLogs"
       ("UserId", "Action", "EntityType", "EntityId", "Description", "IPAddress", "UserAgent", "Metadata")
     VALUES (:userId, :action, :entityType, :entityId, :description, CAST(:ipAddress AS inet), :userAgent, CAST(:metadata AS jsonb))`,
    {
      replacements: {
        userId,
        action: String(action).slice(0, 100),
        entityType: entityType ? String(entityType).slice(0, 100) : null,
        entityId: entityId ?? null,
        description: description ? String(description).slice(0, 4000) : null,
        ipAddress: ipAddress || null,
        userAgent: userAgent ? String(userAgent).slice(0, 2000) : null,
        metadata: JSON.stringify(redactSensitiveValues(metadata)),
      },
      transaction,
    },
  );
}

function activityFromRequest(req, activity) {
  const deviceIdentifier = String(req.get("x-device-id") || "").trim().slice(0, 256);
  return {
    ...activity,
    userId: req.userId,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    metadata: {
      ...(activity.metadata || {}),
      ...(deviceIdentifier ? { deviceIdentifier } : {}),
    },
  };
}

module.exports = { activityFromRequest, writeActivityLog };
