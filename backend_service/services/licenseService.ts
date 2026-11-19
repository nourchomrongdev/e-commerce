const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");

const encryptionKey = crypto
  .createHash("sha256")
  .update(process.env.JWT_SECRET || "local-development-secret-change-me")
  .digest();

function encryptLicenseKey(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}

function decryptLicenseKey(value) {
  if (typeof value !== "string" || !value) return null;
  const parsed = JSON.parse(value);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function hashLicenseKey(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createLicenseKey() {
  return `DPM-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function issueOrderLicenses(orderId) {
  return sequelize.transaction(async (transaction) => {
    const [order] = await sequelize.query(
      `SELECT o."OrderId", o."UserId", o."Status"
       FROM "Orders" o
       WHERE o."OrderId" = :orderId
         AND o."Status" IN ('paid', 'completed')
         AND EXISTS (
           SELECT 1 FROM "Payments" p
           WHERE p."OrderId" = o."OrderId" AND p."Status" = 'paid'
         )
       FOR UPDATE`,
      { replacements: { orderId }, transaction, type: QueryTypes.SELECT },
    );
    if (!order) throw new Error("Cannot issue licenses for an unpaid order.");

    const items = await sequelize.query(
      `SELECT oi."OrderItemId", oi."ProductId", oi."ProductVersionId",
              oi."LicenseTypeId", oi."LicenseTermsSnapshot", oi."Quantity",
              (COALESCE(pvl."RequiresKey", lt."RequiresKey", FALSE)
                OR lower(p."ProductType") ~ '(software|desktop|license\\s*/\\s*key)') AS "RequiresKey",
              lt."DurationDays", lt."MaxActivations",
              COALESCE(NULLIF(oi."LicenseTermsSnapshot", ''),
                NULLIF(pvl."LicenseTerms", ''),
                concat_ws(E'\\n\\n', NULLIF(lt."UsageRights", ''),
                  NULLIF(lt."Restrictions", ''))) AS "Terms"
       FROM "OrderItems" oi
       JOIN "Products" p ON p."ProductId" = oi."ProductId"
       LEFT JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = oi."LicenseTypeId"
       LEFT JOIN "ProductVersionLicenses" pvl
         ON pvl."ProductVersionId" = oi."ProductVersionId"
        AND pvl."LicenseTypeId" = oi."LicenseTypeId"
       WHERE oi."OrderId" = :orderId
       ORDER BY oi."OrderItemId"
       FOR UPDATE OF oi`,
      { replacements: { orderId }, transaction, type: QueryTypes.SELECT },
    );

    let issuedCount = 0;
    for (const item of items) {
      for (let ordinal = 1; ordinal <= Number(item.Quantity); ordinal += 1) {
        const [existing] = await sequelize.query(
          `SELECT "LicenseId" FROM "Licenses"
           WHERE "OrderItemId" = :orderItemId AND "LicenseOrdinal" = :ordinal`,
          { replacements: { orderItemId: item.OrderItemId, ordinal }, transaction, type: QueryTypes.SELECT },
        );
        if (existing) continue;

        const rawKey = createLicenseKey();
        const expiresAt = item.DurationDays
          ? new Date(Date.now() + Number(item.DurationDays) * 86_400_000)
          : null;
        const [licenseRows] = await sequelize.query(
          `INSERT INTO "Licenses"
             ("LicenseKey", "LicenseKeyHash", "OrderItemId", "ProductId", "UserId",
              "LicenseTypeId", "Status", "ExpiresAt", "LicenseOrdinal", "TermsSnapshot",
              "Metadata")
           VALUES
             (:encryptedKey, :keyHash, :orderItemId, :productId, :userId,
              :licenseTypeId, 'active', :expiresAt, :ordinal, :terms,
              jsonb_build_object('requiresKey', :requiresKey, 'maxActivations', :maxActivations))
           RETURNING "LicenseId"`,
          {
            replacements: {
              encryptedKey: encryptLicenseKey(rawKey),
              keyHash: hashLicenseKey(rawKey),
              orderItemId: item.OrderItemId,
              productId: item.ProductId,
              userId: order.UserId,
              licenseTypeId: item.LicenseTypeId,
              expiresAt,
              ordinal,
              terms: item.Terms || "",
              requiresKey: Boolean(item.RequiresKey),
              maxActivations: item.MaxActivations,
            },
            transaction,
          },
        );
        const license = licenseRows[0];
        await sequelize.query(
          `INSERT INTO "LicenseAuditEvents" ("LicenseId", "Action", "Details")
           VALUES (:licenseId, 'issued', jsonb_build_object('orderId', :orderId, 'orderItemId', :orderItemId))`,
          {
            replacements: {
              licenseId: license.LicenseId,
              orderId,
              orderItemId: item.OrderItemId,
            },
            transaction,
          },
        );
        await sequelize.query(
          `INSERT INTO "ActivityLogs"
             ("UserId", "Action", "EntityType", "EntityId", "Description", "Metadata")
           VALUES
             (:userId, 'license.issued', 'License', :licenseId,
              'A product license was issued after successful payment.',
              jsonb_build_object('orderId', :orderId, 'orderItemId', :orderItemId))`,
          {
            replacements: {
              userId: order.UserId,
              licenseId: license.LicenseId,
              orderId,
              orderItemId: item.OrderItemId,
            },
            transaction,
          },
        );
        issuedCount += 1;
      }
    }

    return issuedCount;
  });
}

async function applyRefundLicensePolicy(orderId) {
  return sequelize.transaction(async (transaction) => {
    const [policy] = await sequelize.query(
      `SELECT "RevokeOnRefund" AS "revokeOnRefund",
              "DisableActivationsOnRefund" AS "disableActivationsOnRefund"
       FROM "DRMPolicies" WHERE "DRMPolicyId" = 1`,
      { transaction, type: QueryTypes.SELECT },
    );
    const revokeOnRefund = policy ? Boolean(policy.revokeOnRefund) : true;
    const disableActivations = policy ? Boolean(policy.disableActivationsOnRefund) : true;

    if (revokeOnRefund) {
      const [revoked] = await sequelize.query(
        `UPDATE "Licenses" l
         SET "Status" = 'revoked', "RevokedAt" = CURRENT_TIMESTAMP,
             "RevocationReason" = 'Order refunded.'
         FROM "OrderItems" oi
         WHERE oi."OrderId" = :orderId AND l."OrderItemId" = oi."OrderItemId"
           AND l."Status" IN ('active', 'suspended')
         RETURNING l."LicenseId", l."UserId"`,
        { replacements: { orderId }, transaction },
      );
      for (const license of revoked) {
        await sequelize.query(
          `INSERT INTO "LicenseRevocations" ("LicenseId", "Reason")
           VALUES (:licenseId, 'Order refunded.')`,
          { replacements: { licenseId: license.LicenseId }, transaction },
        );
        await sequelize.query(
          `INSERT INTO "LicenseAuditEvents" ("LicenseId", "Action", "Details")
           VALUES (:licenseId, 'revoked_refund', jsonb_build_object('orderId', :orderId))`,
          { replacements: { licenseId: license.LicenseId, orderId }, transaction },
        );
        await sequelize.query(
          `INSERT INTO "ActivityLogs"
             ("UserId", "Action", "EntityType", "EntityId", "Description", "Metadata")
           VALUES (:userId, 'license.revoked_refund', 'License', :licenseId,
                   'License revoked under refund policy.',
                   jsonb_build_object('orderId', :orderId))`,
          { replacements: { userId: license.UserId, licenseId: license.LicenseId, orderId }, transaction },
        );
      }
    }

    if (disableActivations) {
      await sequelize.query(
        `UPDATE "LicenseActivations" a
         SET "IsActive" = FALSE, "DeactivatedAt" = CURRENT_TIMESTAMP
         FROM "Licenses" l JOIN "OrderItems" oi ON oi."OrderItemId" = l."OrderItemId"
         WHERE oi."OrderId" = :orderId AND a."LicenseId" = l."LicenseId"
           AND a."IsActive" = TRUE`,
        { replacements: { orderId }, transaction },
      );
    }
    return { revokeOnRefund, disableActivations };
  });
}

module.exports = {
  decryptLicenseKey,
  hashLicenseKey,
  issueOrderLicenses,
  applyRefundLicensePolicy,
};
