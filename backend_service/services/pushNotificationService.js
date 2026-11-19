const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");
const webPush = require("web-push");

const vapidPublicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const vapidPrivateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const vapidSubject = String(process.env.VAPID_SUBJECT || "").trim();
const hasVapidKeys = Boolean(vapidPublicKey || vapidPrivateKey);
const isConfigured = Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject);

if (hasVapidKeys && !isConfigured) {
  throw new Error("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT must be configured together.");
}

if (isConfigured) {
  if (!vapidSubject.startsWith("mailto:") && !vapidSubject.startsWith("https://")) {
    throw new Error("VAPID_SUBJECT must be a mailto: address or an HTTPS URL.");
  }
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeEndpoint(value) {
  const endpoint = String(value || "").trim();
  if (!endpoint || endpoint.length > 4096) {
    throw createError("A valid Web Push endpoint is required.", 400);
  }

  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw createError("A valid Web Push endpoint is required.", 400);
  }

  const host = parsed.hostname.toLowerCase();
  const supportedHost =
    host === "fcm.googleapis.com" ||
    host === "web.push.apple.com" ||
    host === "updates.push.services.mozilla.com" ||
    host.endsWith(".push.services.mozilla.com") ||
    /^wns\d+(-[a-z0-9-]+)?\.notify\.windows\.com$/.test(host);

  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443") || !supportedHost) {
    throw createError("The Web Push endpoint is not from a supported push service.", 400);
  }

  return parsed.href;
}

function normalizeSubscription(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createError("A valid browser push subscription is required.", 400);
  }

  const endpoint = normalizeEndpoint(value.endpoint);
  const p256dh = String(value.keys?.p256dh || "");
  const auth = String(value.keys?.auth || "");
  if (!/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_-]+$/.test(auth)) {
    throw createError("The browser push subscription keys are invalid.", 400);
  }
  if (Buffer.from(p256dh, "base64url").length !== 65 || Buffer.from(auth, "base64url").length !== 16) {
    throw createError("The browser push subscription keys are invalid.", 400);
  }

  return { endpoint, p256dh, auth };
}

function endpointHash(endpoint) {
  return crypto.createHash("sha256").update(endpoint).digest("hex");
}

function requireConfigured() {
  if (!isConfigured) throw createError("Web Push is not configured on this server.", 503);
}

async function saveSubscription(userId, input) {
  requireConfigured();
  const subscription = normalizeSubscription(input);
  const [saved] = await sequelize.query(
    `INSERT INTO "NotificationPushSubscriptions"
       ("UserId", "Endpoint", "EndpointHash", "KeysP256dh", "KeysAuth")
     VALUES
       (:userId, :endpoint, :endpointHash, :p256dh, :auth)
     ON CONFLICT ("EndpointHash") DO UPDATE
       SET "UserId" = EXCLUDED."UserId",
           "Endpoint" = EXCLUDED."Endpoint",
           "KeysP256dh" = EXCLUDED."KeysP256dh",
           "KeysAuth" = EXCLUDED."KeysAuth",
           "UpdatedAt" = CURRENT_TIMESTAMP
       WHERE "NotificationPushSubscriptions"."Endpoint" = EXCLUDED."Endpoint"
     RETURNING "PushSubscriptionId"`,
    {
      replacements: {
        userId: Number(userId),
        endpoint: subscription.endpoint,
        endpointHash: endpointHash(subscription.endpoint),
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
      type: QueryTypes.SELECT,
    },
  );
  if (!saved) throw createError("This browser subscription could not be saved.", 409);
}

async function removeSubscription(userId, endpointValue) {
  const endpoint = normalizeEndpoint(endpointValue);
  await sequelize.query(
    `DELETE FROM "NotificationPushSubscriptions"
     WHERE "UserId" = :userId AND "EndpointHash" = :endpointHash AND "Endpoint" = :endpoint`,
    {
      replacements: { userId: Number(userId), endpointHash: endpointHash(endpoint), endpoint },
      type: QueryTypes.DELETE,
    },
  );
}

async function removeExpiredSubscription(userId, endpoint) {
  await sequelize.query(
    `DELETE FROM "NotificationPushSubscriptions"
     WHERE "UserId" = :userId AND "EndpointHash" = :endpointHash`,
    {
      replacements: { userId, endpointHash: endpointHash(endpoint) },
      type: QueryTypes.DELETE,
    },
  );
}

async function deliverToSubscription(userId, subscription, notification) {
  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.Endpoint,
        keys: { p256dh: subscription.KeysP256dh, auth: subscription.KeysAuth },
      },
      JSON.stringify({
        id: String(notification.id),
        title: notification.title,
        body: notification.message,
        href: notification.href,
      }),
      { TTL: 3600, urgency: "normal" },
    );
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      await removeExpiredSubscription(userId, subscription.Endpoint);
      return;
    }
    throw error;
  }
}

async function sendToUser(userId, notification) {
  if (!isConfigured) return;

  const subscriptions = await sequelize.query(
    `SELECT "Endpoint", "KeysP256dh", "KeysAuth"
     FROM "NotificationPushSubscriptions"
     WHERE "UserId" = :userId`,
    { replacements: { userId: Number(userId) }, type: QueryTypes.SELECT },
  );

  const results = await Promise.allSettled(
    subscriptions.map((subscription) => deliverToSubscription(userId, subscription, notification)),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      const error = result.reason;
      console.error("Web Push delivery failed.", {
        userId,
        statusCode: error?.statusCode,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

module.exports = {
  isConfigured: () => isConfigured,
  publicKey: () => isConfigured ? vapidPublicKey : null,
  removeSubscription,
  saveSubscription,
  sendToUser,
};
