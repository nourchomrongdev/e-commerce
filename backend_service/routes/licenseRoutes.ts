const crypto = require("crypto");
const express = require("express");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");
const { decryptLicenseKey, hashLicenseKey } = require("../services/licenseService");
const { readProductFile } = require("../services/productFileService");
const yazl = require("yazl");

const router = express.Router();
const deviceHashKey = crypto
  .createHash("sha256")
  .update(process.env.JWT_SECRET || "local-development-secret-change-me")
  .digest();

function hashDevice(value) {
  return crypto.createHmac("sha256", deviceHashKey).update(value).digest("hex");
}

function requiredText(value, label, maxLength = 4000) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) throw new Error(`${label} is required and must be at most ${maxLength} characters.`);
  return text;
}

function licenseKeyFromRow(value) {
  return decryptLicenseKey(value);
}

function sendFailure(res, error, message) {
  console.error(message, error);
  return res.status(500).json({ error: message });
}

function safeArchiveName(value, fallback = "download") {
  const name = String(value || fallback).replace(/[\\/:*?"<>|\0-\x1f]/g, "_").trim();
  return name || fallback;
}

function createZipBuffer(files) {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const chunks = [];
    archive.outputStream.on("data", (chunk) => chunks.push(chunk));
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    archive.outputStream.on("error", reject);
    for (const file of files) archive.addBuffer(file.buffer, file.fileName);
    try {
      archive.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = function createLicenseRoutes({ requireUser, requireAdmin }) {
  router.get("/buyer/licenses", requireUser, async (req, res) => {
    try {
      const page = Number(req.query.page || 1);
      const requestedPageSize = Number(req.query.pageSize || 20);
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(requestedPageSize) || requestedPageSize < 1) {
        return res.status(400).json({ error: "Page and pageSize must be positive integers." });
      }
      const pageSize = Math.min(requestedPageSize, 100);
      const conditions = ['l."UserId" = :userId'];
      const replacements: Record<string, string | number> = { userId: req.userId };
      if (req.query.status) {
        conditions.push('LOWER(l."Status"::text) = LOWER(:status)');
        replacements.status = String(req.query.status);
      }
      if (req.query.search) {
        conditions.push(`(p."ProductName" ILIKE :search OR lt."LicenseName" ILIKE :search
          OR COALESCE(o."OrderNumber", '') ILIKE :search)`);
        replacements.search = `%${String(req.query.search).trim()}%`;
      }
      const where = conditions.join(" AND ");
      const [[countRow], [rows]] = await Promise.all([
        sequelize.query(
          `SELECT COUNT(*)::int AS total
           FROM "Licenses" l
           JOIN "Products" p ON p."ProductId" = l."ProductId"
           LEFT JOIN "OrderItems" oi ON oi."OrderItemId" = l."OrderItemId"
           LEFT JOIN "Orders" o ON o."OrderId" = oi."OrderId"
           LEFT JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = l."LicenseTypeId"
           WHERE ${where}`,
          { replacements },
        ),
        sequelize.query(
          `SELECT l."LicenseId" AS id, l."UUID" AS uuid, l."Status" AS status,
                  l."IssuedAt" AS "issuedAt", l."ExpiresAt" AS "expiresAt",
                  l."RevocationReason" AS "revocationReason", l."TermsSnapshot" AS terms,
                  l."Metadata" AS metadata, l."LicenseKey" AS "encryptedKey",
                  p."ProductName" AS "productName", p."ProductType" AS "productType",
                  o."OrderNumber" AS "orderNumber", lt."LicenseName" AS "licenseName",
                  lt."MaxActivations" AS "maxActivations",
                  COALESCE((l."Metadata"->>'requiresKey')::boolean, lt."RequiresKey", FALSE) AS "requiresKey",
                  (SELECT COUNT(*) FROM "LicenseActivations" a
                   WHERE a."LicenseId" = l."LicenseId" AND a."IsActive" = TRUE) AS "activeActivations"
           FROM "Licenses" l
           JOIN "Products" p ON p."ProductId" = l."ProductId"
           LEFT JOIN "OrderItems" oi ON oi."OrderItemId" = l."OrderItemId"
           LEFT JOIN "Orders" o ON o."OrderId" = oi."OrderId"
           LEFT JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = l."LicenseTypeId"
           WHERE ${where}
           ORDER BY l."IssuedAt" DESC, l."LicenseId" DESC
           LIMIT :pageSize OFFSET :offset`,
          { replacements: { ...replacements, pageSize, offset: (page - 1) * pageSize } },
        ),
      ]);
      const licenses = rows.map((row) => ({
        ...row,
        id: Number(row.id),
        maxActivations: row.maxActivations === null ? null : Number(row.maxActivations),
        activeActivations: Number(row.activeActivations),
        licenseKey: row.requiresKey ? licenseKeyFromRow(row.encryptedKey) : null,
        encryptedKey: undefined,
      }));
      const total = Number(countRow.total);
      return res.json({ licenses, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
    } catch (error) {
      return sendFailure(res, error, "Unable to load purchased licenses.");
    }
  });

  router.get("/buyer/licenses/:id/activations", requireUser, async (req, res) => {
    try {
      const [rows] = await sequelize.query(
        `SELECT a."ActivationId" AS id, a."DeviceName" AS "deviceName",
                a."ActivatedAt" AS "activatedAt", a."LastValidatedAt" AS "lastValidatedAt",
                a."DeactivatedAt" AS "deactivatedAt", a."IsActive" AS "isActive"
         FROM "LicenseActivations" a
         JOIN "Licenses" l ON l."LicenseId" = a."LicenseId"
         WHERE l."LicenseId" = :licenseId AND l."UserId" = :userId
         ORDER BY a."ActivatedAt" DESC`,
        { replacements: { licenseId: req.params.id, userId: req.userId } },
      );
      return res.json({ activations: rows });
    } catch (error) {
      return sendFailure(res, error, "Unable to load license activations.");
    }
  });

  router.get("/buyer/licenses/:id/downloads", requireUser, async (req, res) => {
    try {
      const [license] = await sequelize.query(
        `SELECT l."LicenseId", l."Status", l."ExpiresAt", l."OrderItemId",
                oi."ProductId", oi."ProductVersionId", oi."LicenseTypeId",
                pvl."DownloadLimit", current_version."ProductVersionId" AS "latestVersionId",
                current_version."VersionNumber" AS "latestVersion",
                latest_pvl."DownloadLimit" AS "latestDownloadLimit",
                (latest_pvl."ProductVersionId" IS NOT NULL) AS "latestVersionLicensed",
                purchased_version."VersionNumber" AS "purchasedVersion"
         FROM "Licenses" l
         JOIN "OrderItems" oi ON oi."OrderItemId" = l."OrderItemId"
         JOIN "Orders" o ON o."OrderId" = oi."OrderId"
         LEFT JOIN "ProductVersionLicenses" pvl
           ON pvl."ProductVersionId" = oi."ProductVersionId"
          AND pvl."LicenseTypeId" = oi."LicenseTypeId"
         LEFT JOIN "ProductVersions" purchased_version
           ON purchased_version."ProductVersionId" = oi."ProductVersionId"
         LEFT JOIN LATERAL (
           SELECT pv."ProductVersionId", pv."VersionNumber"
           FROM "ProductVersions" pv WHERE pv."ProductId" = oi."ProductId"
           ORDER BY pv."IsCurrent" DESC, pv."CreatedAt" DESC, pv."ProductVersionId" DESC
           LIMIT 1
         ) current_version ON TRUE
         LEFT JOIN "ProductVersionLicenses" latest_pvl
           ON latest_pvl."ProductVersionId" = current_version."ProductVersionId"
          AND latest_pvl."LicenseTypeId" = oi."LicenseTypeId"
         WHERE l."LicenseId" = :licenseId AND l."UserId" = :userId
           AND EXISTS (
             SELECT 1 FROM "Payments" pay
             WHERE pay."OrderId" = o."OrderId" AND pay."PaidAt" IS NOT NULL
               AND pay."Status" IN ('paid', 'partially_refunded', 'refunded')
           )
         LIMIT 1`,
        { replacements: { licenseId: req.params.id, userId: req.userId } },
      );
      if (!license) return res.status(404).json({ error: "License not found." });
      if (license.Status !== "active" || (license.ExpiresAt && new Date(license.ExpiresAt) <= new Date())) {
        return res.status(409).json({ error: "Downloads are unavailable for this license." });
      }
      const useLatestVersion = String(req.query.version || "").toLowerCase() === "latest";
      if (useLatestVersion && !license.latestVersionLicensed) {
        return res.status(409).json({ error: "The latest product version is not available for this license." });
      }
      const selectedVersionId = useLatestVersion ? license.latestVersionId : license.ProductVersionId;
      const selectedDownloadLimit = useLatestVersion ? license.latestDownloadLimit : license.DownloadLimit;
      const [files] = await sequelize.query(
        `SELECT pf."ProductFileId" AS id, pf."UUID" AS uuid,
                pf."FileName" AS "fileName", pf."FileSize" AS "fileSize",
                pf."MimeType" AS "mimeType",
                COALESCE((SELECT SUM(d."DownloadCount") FROM "Downloads" d
                          WHERE d."OrderItemId" = :orderItemId), 0)::int AS "downloadCount",
                CAST(:versionId AS bigint) AS "productVersionId"
         FROM "ProductFiles" pf
         WHERE pf."ProductId" = :productId AND pf."IsActive" = TRUE
           AND ((CAST(:versionId AS bigint) IS NULL AND pf."ProductVersionId" IS NULL)
             OR pf."ProductVersionId" = CAST(:versionId AS bigint))
         ORDER BY pf."CreatedAt", pf."ProductFileId"`,
        {
          replacements: {
            orderItemId: license.OrderItemId,
            productId: license.ProductId,
            versionId: selectedVersionId,
          },
        },
      );
      return res.json({
        selectedVersion: useLatestVersion ? "latest" : "purchased",
        purchasedVersion: license.purchasedVersion || "Legacy version",
        latestVersion: license.latestVersion || null,
        latestVersionLicensed: Boolean(license.latestVersionLicensed),
        files: files.map((file) => ({
          ...file,
          id: Number(file.id),
          fileSize: Number(file.fileSize),
          downloadCount: Number(file.downloadCount),
          downloadLimit: selectedDownloadLimit === null ? null : Number(selectedDownloadLimit),
        })),
      });
    } catch (error) {
      return sendFailure(res, error, "Unable to load licensed product downloads.");
    }
  });

  router.get("/buyer/licenses/:id/downloads.zip", requireUser, async (req, res) => {
    try {
      const result = await sequelize.transaction(async (transaction) => {
        const [license] = await sequelize.query(
          `SELECT l."LicenseId", l."Status", l."ExpiresAt", l."OrderItemId",
                  oi."ProductId", oi."ProductVersionId", oi."LicenseTypeId",
                  p."ProductName", pvl."DownloadLimit",
                  current_version."ProductVersionId" AS "latestVersionId",
                  latest_pvl."DownloadLimit" AS "latestDownloadLimit",
                  (latest_pvl."ProductVersionId" IS NOT NULL) AS "latestVersionLicensed"
           FROM "Licenses" l
           JOIN "OrderItems" oi ON oi."OrderItemId" = l."OrderItemId"
           JOIN "Orders" o ON o."OrderId" = oi."OrderId"
           JOIN "Products" p ON p."ProductId" = oi."ProductId"
           LEFT JOIN "ProductVersionLicenses" pvl
             ON pvl."ProductVersionId" = oi."ProductVersionId"
            AND pvl."LicenseTypeId" = oi."LicenseTypeId"
           LEFT JOIN LATERAL (
             SELECT pv."ProductVersionId"
             FROM "ProductVersions" pv WHERE pv."ProductId" = oi."ProductId"
             ORDER BY pv."IsCurrent" DESC, pv."CreatedAt" DESC, pv."ProductVersionId" DESC
             LIMIT 1
           ) current_version ON TRUE
           LEFT JOIN "ProductVersionLicenses" latest_pvl
             ON latest_pvl."ProductVersionId" = current_version."ProductVersionId"
            AND latest_pvl."LicenseTypeId" = oi."LicenseTypeId"
           WHERE l."LicenseId" = :licenseId AND l."UserId" = :userId
             AND EXISTS (
               SELECT 1 FROM "Payments" pay
               WHERE pay."OrderId" = o."OrderId" AND pay."PaidAt" IS NOT NULL
                 AND pay."Status" IN ('paid', 'partially_refunded', 'refunded')
             )
           FOR UPDATE OF l`,
          {
            replacements: { licenseId: req.params.id, userId: req.userId },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        if (!license) return { status: 404, error: "License not found." };
        if (license.Status !== "active" || (license.ExpiresAt && new Date(license.ExpiresAt) <= new Date())) {
          return { status: 409, error: "Downloads are unavailable for this license." };
        }

        const useLatestVersion = String(req.query.version || "").toLowerCase() === "latest";
        if (useLatestVersion && !license.latestVersionLicensed) {
          return { status: 409, error: "The latest product version is not available for this license." };
        }
        const selectedVersionId = useLatestVersion ? license.latestVersionId : license.ProductVersionId;
        const selectedDownloadLimit = useLatestVersion ? license.latestDownloadLimit : license.DownloadLimit;
        const [files] = await sequelize.query(
          `SELECT "ProductFileId", "FileName", "StorageKey", "MimeType"
           FROM "ProductFiles"
           WHERE "ProductId" = :productId AND "IsActive" = TRUE
             AND ((CAST(:versionId AS bigint) IS NULL AND "ProductVersionId" IS NULL)
               OR "ProductVersionId" = CAST(:versionId AS bigint))
           ORDER BY "CreatedAt", "ProductFileId"`,
          {
            replacements: { productId: license.ProductId, versionId: selectedVersionId },
            transaction,
          },
        );
        if (!files.length) return { status: 404, error: "No downloadable files are available for this product version." };

        const [countRows] = await sequelize.query(
          `SELECT COALESCE(SUM("DownloadCount"), 0)::int AS count
           FROM "Downloads" WHERE "OrderItemId" = :orderItemId`,
          { replacements: { orderItemId: license.OrderItemId }, transaction },
        );
        const downloadCount = Number(countRows[0].count);
        const downloadLimit = selectedDownloadLimit === null ? null : Number(selectedDownloadLimit);
        if (downloadLimit !== null && downloadCount + files.length > downloadLimit) {
          return { status: 409, error: "This license does not have enough downloads remaining for all files in the ZIP." };
        }

        const archiveFiles = [];
        const usedNames = new Set();
        for (const file of files) {
          const fileContent = await readProductFile(file.StorageKey);
          const baseName = safeArchiveName(file.FileName);
          let fileName = baseName;
          let suffix = 2;
          while (usedNames.has(fileName.toLowerCase())) {
            const extensionIndex = baseName.lastIndexOf(".");
            const stem = extensionIndex > 0 ? baseName.slice(0, extensionIndex) : baseName;
            const extension = extensionIndex > 0 ? baseName.slice(extensionIndex) : "";
            fileName = `${stem} (${suffix})${extension}`;
            suffix += 1;
          }
          usedNames.add(fileName.toLowerCase());
          archiveFiles.push({ file, fileName, buffer: fileContent.buffer });
        }
        const zipBuffer = await createZipBuffer(archiveFiles);
        const userAgent = String(req.get("user-agent") || "").slice(0, 2000);

        for (const { file } of archiveFiles) {
          const [existingRows] = await sequelize.query(
            `SELECT "DownloadId" FROM "Downloads"
             WHERE "OrderItemId" = :orderItemId AND "ProductFileId" = :fileId AND "UserId" = :userId
             LIMIT 1 FOR UPDATE`,
            {
              replacements: {
                orderItemId: license.OrderItemId,
                fileId: file.ProductFileId,
                userId: req.userId,
              },
              transaction,
            },
          );
          if (existingRows[0]) {
            await sequelize.query(
              `UPDATE "Downloads"
               SET "DownloadCount" = "DownloadCount" + 1,
                   "DownloadedAt" = CURRENT_TIMESTAMP, "IPAddress" = CAST(:ip AS inet),
                   "UserAgent" = :userAgent
               WHERE "DownloadId" = :downloadId`,
              {
                replacements: { downloadId: existingRows[0].DownloadId, ip: req.ip, userAgent },
                transaction,
              },
            );
          } else {
            await sequelize.query(
              `INSERT INTO "Downloads"
                 ("OrderItemId", "ProductFileId", "UserId", "DownloadedAt", "IPAddress", "UserAgent", "DownloadCount")
               VALUES (:orderItemId, :fileId, :userId, CURRENT_TIMESTAMP, CAST(:ip AS inet), :userAgent, 1)`,
              {
                replacements: {
                  orderItemId: license.OrderItemId,
                  fileId: file.ProductFileId,
                  userId: req.userId,
                  ip: req.ip,
                  userAgent,
                },
                transaction,
              },
            );
          }
          await sequelize.query(
            `INSERT INTO "ActivityLogs"
               ("UserId", "Action", "EntityType", "EntityId", "IPAddress", "UserAgent", "Description", "Metadata")
             VALUES (:userId, 'product.downloaded', 'ProductFile', :fileId, CAST(:ip AS inet),
                     :userAgent, 'A purchased product file was downloaded in a ZIP archive.',
                     jsonb_build_object('licenseId', :licenseId, 'orderItemId', :orderItemId))`,
            {
              replacements: {
                userId: req.userId,
                fileId: file.ProductFileId,
                ip: req.ip,
                userAgent,
                licenseId: license.LicenseId,
                orderItemId: license.OrderItemId,
              },
              transaction,
            },
          );
        }

        return {
          buffer: zipBuffer,
          fileName: `${safeArchiveName(license.ProductName, "product")}.zip`,
        };
      });
      if (result.status) return res.status(result.status).json({ error: result.error });
      const asciiFileName = result.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
      res.setHeader("Content-Length", result.buffer.length);
      return res.send(result.buffer);
    } catch (error) {
      return sendFailure(res, error, "Unable to download the product ZIP archive.");
    }
  });

  router.get("/buyer/licenses/:id/downloads/:fileId", requireUser, async (req, res) => {
    return res.status(410).json({ error: "Individual file downloads are disabled. Download the product ZIP instead." });
  });

  router.post("/buyer/licenses/:id/activations", requireUser, async (req, res) => {
    const deviceIdentifier = String(req.body?.deviceIdentifier || "").trim();
    if (deviceIdentifier.length < 8 || deviceIdentifier.length > 512) {
      return res.status(400).json({ error: "A device identifier between 8 and 512 characters is required." });
    }
    try {
      const result = await sequelize.transaction(async (transaction) => {
        const [license] = await sequelize.query(
          `SELECT l."LicenseId", l."Status", l."ExpiresAt", l."Metadata",
                  p."ProductType" AS "productType", lt."MaxActivations" AS "maxActivations"
           FROM "Licenses" l
           JOIN "Products" p ON p."ProductId" = l."ProductId"
           LEFT JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = l."LicenseTypeId"
           WHERE l."LicenseId" = :licenseId AND l."UserId" = :userId
           FOR UPDATE OF l`,
          { replacements: { licenseId: req.params.id, userId: req.userId }, transaction },
        );
        if (!license) return { status: 404, error: "License not found." };
        if (!String(license.productType || "").toLowerCase().match(/software|desktop|license\s*\/\s*key/)) {
          return { status: 400, error: "Device activation is available only for software products." };
        }
        if (license.Status !== "active" || (license.ExpiresAt && new Date(license.ExpiresAt) <= new Date())) {
          return { status: 409, error: "This license is not active." };
        }
        const deviceHash = hashDevice(deviceIdentifier);
        const [existing] = await sequelize.query(
          `SELECT "ActivationId" AS id FROM "LicenseActivations"
           WHERE "LicenseId" = :licenseId AND "DeviceIdentifierHash" = :deviceHash
             AND "IsActive" = TRUE`,
          { replacements: { licenseId: license.LicenseId, deviceHash }, transaction },
        );
        if (existing) {
          await sequelize.query(
            `UPDATE "LicenseActivations" SET "LastValidatedAt" = CURRENT_TIMESTAMP
             WHERE "ActivationId" = :activationId`,
            { replacements: { activationId: existing.id }, transaction },
          );
          return { activation: existing };
        }
        const [countRow] = await sequelize.query(
          `SELECT COUNT(*)::int AS count FROM "LicenseActivations"
           WHERE "LicenseId" = :licenseId AND "IsActive" = TRUE`,
          { replacements: { licenseId: license.LicenseId }, transaction },
        );
        const activationLimit = Number(license.maxActivations || license.Metadata?.maxActivations || 0);
        if (activationLimit > 0 && Number(countRow.count) >= activationLimit) {
          return { status: 409, error: "This license has reached its activation limit." };
        }
        const [activation] = await sequelize.query(
          `INSERT INTO "LicenseActivations"
             ("LicenseId", "DeviceIdentifierHash", "DeviceName", "IPAddress", "UserAgent", "LastValidatedAt")
           VALUES (:licenseId, :deviceHash, :deviceName, CAST(:ip AS inet), :userAgent, CURRENT_TIMESTAMP)
           RETURNING "ActivationId" AS id, "DeviceName" AS "deviceName", "ActivatedAt" AS "activatedAt"`,
          {
            replacements: {
              licenseId: license.LicenseId,
              deviceHash,
              deviceName: String(req.body?.deviceName || "").trim().slice(0, 255) || null,
              ip: req.ip,
              userAgent: String(req.get("user-agent") || "").slice(0, 2000),
            },
            transaction,
          },
        );
        await sequelize.query(
          `INSERT INTO "LicenseAuditEvents" ("LicenseId", "ActorUserId", "Action", "Details")
           VALUES (:licenseId, :userId, 'activated', jsonb_build_object('activationId', :activationId))`,
          { replacements: { licenseId: license.LicenseId, userId: req.userId, activationId: activation.id }, transaction },
        );
        await sequelize.query(
          `INSERT INTO "ActivityLogs" ("UserId", "Action", "EntityType", "EntityId", "Description")
           VALUES (:userId, 'license.activated', 'License', :licenseId, 'A license device was activated.')`,
          { replacements: { userId: req.userId, licenseId: license.LicenseId }, transaction },
        );
        return { activation };
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.status(result.activation.id ? 200 : 201).json(result);
    } catch (error) {
      return sendFailure(res, error, "Unable to activate this device.");
    }
  });

  router.delete("/buyer/licenses/:id/activations/:activationId", requireUser, async (req, res) => {
    try {
      const [rows] = await sequelize.query(
        `UPDATE "LicenseActivations" a
         SET "IsActive" = FALSE, "DeactivatedAt" = CURRENT_TIMESTAMP
         FROM "Licenses" l
         WHERE a."ActivationId" = :activationId AND a."LicenseId" = l."LicenseId"
           AND l."LicenseId" = :licenseId AND l."UserId" = :userId
         RETURNING a."LicenseId"`,
        { replacements: { activationId: req.params.activationId, licenseId: req.params.id, userId: req.userId } },
      );
      if (!rows[0]) return res.status(404).json({ error: "Activation not found." });
      await sequelize.query(
        `INSERT INTO "LicenseAuditEvents" ("LicenseId", "ActorUserId", "Action", "Details")
         VALUES (:licenseId, :userId, 'deactivated', jsonb_build_object('activationId', :activationId))`,
        { replacements: { licenseId: rows[0].LicenseId, userId: req.userId, activationId: req.params.activationId } },
      );
      await sequelize.query(
        `INSERT INTO "ActivityLogs" ("UserId", "Action", "EntityType", "EntityId", "Description")
         VALUES (:userId, 'license.deactivated', 'License', :licenseId, 'A license device was deactivated.')`,
        { replacements: { userId: req.userId, licenseId: rows[0].LicenseId } },
      );
      return res.json({ success: true });
    } catch (error) {
      return sendFailure(res, error, "Unable to deactivate this device.");
    }
  });

  router.post("/licenses/validate", async (req, res) => {
    const licenseKey = String(req.body?.licenseKey || "").trim();
    const deviceIdentifier = String(req.body?.deviceIdentifier || "").trim();
    if (!licenseKey || licenseKey.length > 512) return res.status(400).json({ error: "A valid license key is required." });
    try {
      const keyHash = hashLicenseKey(licenseKey);
      const deviceHash = deviceIdentifier ? hashDevice(deviceIdentifier) : null;
      const [license] = await sequelize.query(
        `SELECT l."LicenseId", l."Status", l."ExpiresAt", l."Metadata",
                p."ProductType" AS "productType", lt."MaxActivations" AS "maxActivations"
         FROM "Licenses" l
         JOIN "Products" p ON p."ProductId" = l."ProductId"
         LEFT JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = l."LicenseTypeId"
         WHERE l."LicenseKeyHash" = :keyHash
         LIMIT 1`,
        { replacements: { keyHash } },
      );
      let reason = "valid";
      let isValid = Boolean(license && license.Status === "active" && (!license.ExpiresAt || new Date(license.ExpiresAt) > new Date()));
      if (!license) reason = "not_found";
      else if (license.Status !== "active") reason = "inactive";
      else if (license.ExpiresAt && new Date(license.ExpiresAt) <= new Date()) reason = "expired";
      if (isValid && deviceHash && String(license.productType || "").toLowerCase().match(/software|desktop|license\s*\/\s*key/)) {
        const result = await sequelize.transaction(async (transaction) => {
          const [currentLicense] = await sequelize.query(
            `SELECT l."Status", l."ExpiresAt", l."Metadata",
                    lt."MaxActivations" AS "maxActivations"
             FROM "Licenses" l
             LEFT JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = l."LicenseTypeId"
             WHERE l."LicenseId" = :licenseId FOR UPDATE OF l`,
            { replacements: { licenseId: license.LicenseId }, transaction },
          );
          if (!currentLicense) return { valid: false, reason: "not_found" };
          if (currentLicense.Status !== "active") return { valid: false, reason: "inactive" };
          if (currentLicense.ExpiresAt && new Date(currentLicense.ExpiresAt) <= new Date()) {
            return { valid: false, reason: "expired" };
          }
          const [current] = await sequelize.query(
            `SELECT "ActivationId" FROM "LicenseActivations"
             WHERE "LicenseId" = :licenseId AND "DeviceIdentifierHash" = :deviceHash
               AND "IsActive" = TRUE`,
            { replacements: { licenseId: license.LicenseId, deviceHash }, transaction },
          );
          if (current) {
            await sequelize.query(
              `UPDATE "LicenseActivations" SET "LastValidatedAt" = CURRENT_TIMESTAMP
               WHERE "ActivationId" = :activationId`,
              { replacements: { activationId: current.ActivationId }, transaction },
            );
            return { valid: true, reason: "valid" };
          }
          const [countRow] = await sequelize.query(
            `SELECT COUNT(*)::int AS count FROM "LicenseActivations"
             WHERE "LicenseId" = :licenseId AND "IsActive" = TRUE`,
            { replacements: { licenseId: license.LicenseId }, transaction },
          );
          const limit = Number(currentLicense.maxActivations || currentLicense.Metadata?.maxActivations || 0);
          if (limit > 0 && Number(countRow.count) >= limit) return { valid: false, reason: "activation_limit" };
          await sequelize.query(
            `INSERT INTO "LicenseActivations"
               ("LicenseId", "DeviceIdentifierHash", "IPAddress", "UserAgent", "LastValidatedAt")
             VALUES (:licenseId, :deviceHash, CAST(:ip AS inet), :userAgent, CURRENT_TIMESTAMP)`,
            {
              replacements: {
                licenseId: license.LicenseId,
                deviceHash,
                ip: req.ip,
                userAgent: String(req.get("user-agent") || "").slice(0, 2000),
              },
              transaction,
            },
          );
          return { valid: true, reason: "valid" };
        });
        isValid = result.valid;
        reason = result.reason;
      }
      await sequelize.query(
        `INSERT INTO "LicenseValidationLogs"
           ("LicenseId", "KeyHash", "DeviceIdentifierHash", "IsValid", "Reason", "IPAddress")
         VALUES (:licenseId, :keyHash, :deviceHash, :isValid, :reason, CAST(:ip AS inet))`,
        {
          replacements: {
            licenseId: license?.LicenseId || null,
            keyHash,
            deviceHash,
            isValid,
            reason,
            ip: req.ip,
          },
        },
      );
      return res.json({ valid: isValid, reason });
    } catch (error) {
      return sendFailure(res, error, "Unable to validate this license.");
    }
  });

  router.post("/licenses/account/validate", requireUser, async (req, res) => {
    const productId = Number(req.body?.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: "A valid productId is required." });
    }
    try {
      const result = await sequelize.transaction(async (transaction) => {
        const [license] = await sequelize.query(
          `SELECT l."LicenseId" AS id, l."Status" AS status, l."ExpiresAt" AS "expiresAt",
                  l."IssuedAt" AS "issuedAt", l."TermsSnapshot" AS terms,
                  lt."LicenseName" AS "licenseName", lt."UsageRights" AS "usageRights",
                  lt."Restrictions" AS restrictions
           FROM "Licenses" l
           LEFT JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = l."LicenseTypeId"
           WHERE l."UserId" = :userId AND l."ProductId" = :productId
           ORDER BY l."IssuedAt" DESC, l."LicenseId" DESC
           LIMIT 1 FOR UPDATE OF l`,
          { replacements: { userId: req.userId, productId }, transaction },
        );
        if (!license) return { valid: false, reason: "not_found" };
        if (license.status !== "active") return { valid: false, reason: "inactive" };
        if (license.expiresAt && new Date(license.expiresAt) <= new Date()) {
          return { valid: false, reason: "expired" };
        }
        return {
          valid: true,
          reason: "valid",
          license: {
            id: Number(license.id),
            licenseName: license.licenseName,
            issuedAt: license.issuedAt,
            expiresAt: license.expiresAt,
            terms: license.terms,
            usageRights: license.usageRights,
            restrictions: license.restrictions,
          },
        };
      });
      return res.json(result);
    } catch (error) {
      return sendFailure(res, error, "Unable to validate this account license.");
    }
  });

  router.get("/admin/license-types", requireAdmin, async (_req, res) => {
    try {
      const [licenseTypes] = await sequelize.query(
        `SELECT "LicenseTypeId" AS id, "LicenseName" AS name, "Description" AS description,
                "UsageRights" AS "usageRights", "Restrictions" AS restrictions,
                "MaxActivations" AS "maxActivations", "DurationDays" AS "durationDays",
                "RequiresKey" AS "requiresKey", "IsActive" AS "isActive"
         FROM "LicenseTypes" WHERE "StorefrontId" IS NULL ORDER BY "LicenseTypeId"`,
      );
      return res.json({ licenseTypes });
    } catch (error) {
      return sendFailure(res, error, "Unable to load global license types.");
    }
  });

  router.post("/admin/license-types", requireAdmin, async (req, res) => {
    try {
      const name = requiredText(req.body?.name, "License name", 100).toLowerCase();
      const maxActivations = req.body?.maxActivations == null || req.body.maxActivations === ""
        ? null
        : Number(req.body.maxActivations);
      const durationDays = req.body?.durationDays == null || req.body.durationDays === ""
        ? null
        : Number(req.body.durationDays);
      if (maxActivations !== null && (!Number.isInteger(maxActivations) || maxActivations < 1)) {
        return res.status(400).json({ error: "Activation limit must be a positive whole number." });
      }
      if (durationDays !== null && (!Number.isInteger(durationDays) || durationDays < 1)) {
        return res.status(400).json({ error: "Expiration must be a positive number of days." });
      }
      const [rows] = await sequelize.query(
        `INSERT INTO "LicenseTypes"
           ("LicenseName", "Description", "UsageRights", "Restrictions",
            "MaxActivations", "DurationDays", "RequiresKey", "IsActive", "StorefrontId")
         VALUES (:name, :description, :usageRights, :restrictions,
                 :maxActivations, :durationDays, :requiresKey, :isActive, NULL)
         RETURNING "LicenseTypeId" AS id`,
        {
          replacements: {
            name,
            description: String(req.body?.description || "").trim(),
            usageRights: String(req.body?.usageRights || "").trim(),
            restrictions: String(req.body?.restrictions || "").trim(),
            maxActivations,
            durationDays,
            requiresKey: Boolean(req.body?.requiresKey),
            isActive: req.body?.isActive !== false,
          },
        },
      );
      await sequelize.query(
        `INSERT INTO "ActivityLogs" ("UserId", "Action", "EntityType", "EntityId", "Description")
         VALUES (:userId, 'license_type.created', 'LicenseType', :licenseTypeId,
                 'A global license type was created.')`,
        { replacements: { userId: req.userId, licenseTypeId: rows[0].id } },
      );
      return res.status(201).json({ id: rows[0].id });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError" || error.original?.code === "23505") {
        return res.status(409).json({ error: "A global license type with that name already exists." });
      }
      return sendFailure(res, error, "Unable to create license type.");
    }
  });

  router.patch("/admin/license-types/:id", requireAdmin, async (req, res) => {
    try {
      const maxActivations = req.body?.maxActivations === undefined ? undefined
        : req.body.maxActivations === null || req.body.maxActivations === "" ? null : Number(req.body.maxActivations);
      const durationDays = req.body?.durationDays === undefined ? undefined
        : req.body.durationDays === null || req.body.durationDays === "" ? null : Number(req.body.durationDays);
      if (maxActivations !== undefined && maxActivations !== null && (!Number.isInteger(maxActivations) || maxActivations < 1)) {
        return res.status(400).json({ error: "Activation limit must be a positive whole number." });
      }
      if (durationDays !== undefined && durationDays !== null && (!Number.isInteger(durationDays) || durationDays < 1)) {
        return res.status(400).json({ error: "Expiration must be a positive number of days." });
      }
      const [rows] = await sequelize.query(
        `UPDATE "LicenseTypes"
         SET "LicenseName" = COALESCE(:name, "LicenseName"),
             "Description" = COALESCE(:description, "Description"),
             "UsageRights" = COALESCE(:usageRights, "UsageRights"),
             "Restrictions" = COALESCE(:restrictions, "Restrictions"),
             "MaxActivations" = CASE WHEN :hasMaxActivations THEN :maxActivations ELSE "MaxActivations" END,
             "DurationDays" = CASE WHEN :hasDurationDays THEN :durationDays ELSE "DurationDays" END,
             "RequiresKey" = COALESCE(:requiresKey, "RequiresKey"),
             "IsActive" = COALESCE(:isActive, "IsActive")
         WHERE "LicenseTypeId" = :id AND "StorefrontId" IS NULL
         RETURNING "LicenseTypeId"`,
        {
          replacements: {
            id: req.params.id,
            name: req.body?.name === undefined ? null : requiredText(req.body.name, "License name", 100).toLowerCase(),
            description: req.body?.description ?? null,
            usageRights: req.body?.usageRights ?? null,
            restrictions: req.body?.restrictions ?? null,
            maxActivations: maxActivations ?? null,
            hasMaxActivations: maxActivations !== undefined,
            durationDays: durationDays ?? null,
            hasDurationDays: durationDays !== undefined,
            requiresKey: req.body?.requiresKey === undefined ? null : Boolean(req.body.requiresKey),
            isActive: req.body?.isActive === undefined ? null : Boolean(req.body.isActive),
          },
        },
      );
      if (rows[0]) {
        await sequelize.query(
          `INSERT INTO "ActivityLogs" ("UserId", "Action", "EntityType", "EntityId", "Description")
           VALUES (:userId, 'license_type.updated', 'LicenseType', :licenseTypeId,
                   'A global license type was updated.')`,
          { replacements: { userId: req.userId, licenseTypeId: req.params.id } },
        );
      }
      return rows[0] ? res.json({ success: true }) : res.status(404).json({ error: "Global license type not found." });
    } catch (error) {
      if (error.original?.code === "23505") return res.status(409).json({ error: "A global license type with that name already exists." });
      return sendFailure(res, error, "Unable to update license type.");
    }
  });

  router.get("/admin/drm-policy", requireAdmin, async (_req, res) => {
    try {
      const [rows] = await sequelize.query(
        `SELECT "RevokeOnRefund" AS "revokeOnRefund",
                "DisableActivationsOnRefund" AS "disableActivationsOnRefund",
                "UpdatedAt" AS "updatedAt"
         FROM "DRMPolicies" WHERE "DRMPolicyId" = 1`,
      );
      return res.json({ policy: rows[0] || { revokeOnRefund: true, disableActivationsOnRefund: true } });
    } catch (error) {
      return sendFailure(res, error, "Unable to load DRM policy.");
    }
  });

  router.patch("/admin/drm-policy", requireAdmin, async (req, res) => {
    if (typeof req.body?.revokeOnRefund !== "boolean" || typeof req.body?.disableActivationsOnRefund !== "boolean") {
      return res.status(400).json({ error: "Set both refund revocation policy options." });
    }
    try {
      await sequelize.transaction(async (transaction) => {
        await sequelize.query(
          `UPDATE "DRMPolicies"
           SET "RevokeOnRefund" = :revokeOnRefund,
               "DisableActivationsOnRefund" = :disableActivationsOnRefund,
               "UpdatedByUserId" = :userId, "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "DRMPolicyId" = 1`,
          {
            replacements: {
              userId: req.userId,
              revokeOnRefund: req.body.revokeOnRefund,
              disableActivationsOnRefund: req.body.disableActivationsOnRefund,
            },
            transaction,
          },
        );
        await sequelize.query(
          `INSERT INTO "ActivityLogs" ("UserId", "Action", "EntityType", "EntityId", "Description", "Metadata")
           VALUES (:userId, 'drm.policy_updated', 'DRMPolicy', 1,
                   'DRM refund policy updated.',
                   jsonb_build_object('revokeOnRefund', :revokeOnRefund,
                                      'disableActivationsOnRefund', :disableActivationsOnRefund))`,
          {
            replacements: {
              userId: req.userId,
              revokeOnRefund: req.body.revokeOnRefund,
              disableActivationsOnRefund: req.body.disableActivationsOnRefund,
            },
            transaction,
          },
        );
      });
      return res.json({ success: true });
    } catch (error) {
      return sendFailure(res, error, "Unable to save DRM policy.");
    }
  });

  router.get("/admin/licenses", requireAdmin, async (req, res) => {
    try {
      const search = `%${String(req.query.search || "").trim()}%`;
      const status = String(req.query.status || "").trim().toLowerCase();
      const [licenses] = await sequelize.query(
        `SELECT l."LicenseId" AS id, l."Status" AS status, l."IssuedAt" AS "issuedAt",
                l."ExpiresAt" AS "expiresAt", l."RevokedAt" AS "revokedAt",
                l."RevocationReason" AS "revocationReason",
                p."ProductName" AS "productName", o."OrderNumber" AS "orderNumber",
                lt."LicenseName" AS "licenseType", ui."Email" AS "buyerEmail",
                RIGHT(COALESCE(l."LicenseKeyHash", ''), 4) AS "keySuffix"
         FROM "Licenses" l
         JOIN "Products" p ON p."ProductId" = l."ProductId"
         LEFT JOIN "OrderItems" oi ON oi."OrderItemId" = l."OrderItemId"
         LEFT JOIN "Orders" o ON o."OrderId" = oi."OrderId"
         LEFT JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = l."LicenseTypeId"
         LEFT JOIN "UserAccounts" ua ON ua."UserId" = l."UserId"
         LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE (p."ProductName" ILIKE :search OR COALESCE(ui."Email", '') ILIKE :search
                OR COALESCE(o."OrderNumber", '') ILIKE :search)
           AND (:status = '' OR lower(l."Status"::text) = :status)
         ORDER BY l."IssuedAt" DESC LIMIT 200`,
        { replacements: { search, status } },
      );
      return res.json({ licenses });
    } catch (error) {
      return sendFailure(res, error, "Unable to load licenses.");
    }
  });

  router.get("/admin/licenses/:id/audit", requireAdmin, async (req, res) => {
    try {
      const [events] = await sequelize.query(
        `SELECT e."Action" AS action, e."Details" AS details, e."CreatedAt" AS "createdAt",
                ui."Email" AS "actorEmail"
         FROM "LicenseAuditEvents" e
         LEFT JOIN "UserAccounts" ua ON ua."UserId" = e."ActorUserId"
         LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE e."LicenseId" = :id ORDER BY e."CreatedAt" DESC`,
        { replacements: { id: req.params.id } },
      );
      return res.json({ events });
    } catch (error) {
      return sendFailure(res, error, "Unable to load license history.");
    }
  });

  router.patch("/admin/licenses/:id", requireAdmin, async (req, res) => {
    const status = String(req.body?.status || "").toLowerCase();
    if (!["active", "suspended", "revoked"].includes(status)) {
      return res.status(400).json({ error: "Status must be active, suspended, or revoked." });
    }
    if (status === "revoked" && !String(req.body?.reason || "").trim()) {
      return res.status(400).json({ error: "A reason is required to revoke a license." });
    }
    try {
      const reason = String(req.body.reason || "").trim();
      const result = await sequelize.transaction(async (transaction) => {
        const [licenses] = await sequelize.query(
          `SELECT "LicenseId", "UserId", "Status"
           FROM "Licenses" WHERE "LicenseId" = :id FOR UPDATE`,
          { replacements: { id: req.params.id }, transaction },
        );
        if (!licenses[0]) return false;
        const [rows] = await sequelize.query(
          `UPDATE "Licenses"
           SET "Status" = :status,
               "RevokedAt" = CASE WHEN :status = 'revoked' THEN CURRENT_TIMESTAMP ELSE NULL END,
               "RevocationReason" = CASE WHEN :status = 'revoked' THEN :reason ELSE NULL END
           WHERE "LicenseId" = :id
           RETURNING "LicenseId"`,
          { replacements: { id: req.params.id, status, reason }, transaction },
        );
        if (status === "revoked" && licenses[0].Status !== "revoked") {
          await sequelize.query(
            `INSERT INTO "LicenseRevocations" ("LicenseId", "ActorUserId", "Reason")
             VALUES (:id, :actorId, :reason)`,
            { replacements: { id: req.params.id, actorId: req.userId, reason }, transaction },
          );
        }
        if (status !== "active") {
          await sequelize.query(
            `UPDATE "LicenseActivations" SET "IsActive" = FALSE, "DeactivatedAt" = CURRENT_TIMESTAMP
             WHERE "LicenseId" = :id AND "IsActive" = TRUE`,
            { replacements: { id: req.params.id }, transaction },
          );
        }
        await sequelize.query(
          `INSERT INTO "LicenseAuditEvents" ("LicenseId", "ActorUserId", "Action", "Details")
           VALUES (:id, :actorId, :action, jsonb_build_object('reason', :reason))`,
          {
            replacements: {
              id: req.params.id,
              actorId: req.userId,
              action: status === "revoked" ? "revoked" : status === "suspended" ? "suspended" : "reactivated",
              reason,
            },
            transaction,
          },
        );
        await sequelize.query(
          `INSERT INTO "ActivityLogs"
             ("UserId", "Action", "EntityType", "EntityId", "Description", "Metadata")
           VALUES (:actorId, :action, 'License', :id, 'An administrator changed a product license status.',
                   jsonb_build_object('status', :status, 'reason', :reason))`,
          {
            replacements: {
              actorId: req.userId,
              action: `license.${status}`,
              id: req.params.id,
              status,
              reason,
            },
            transaction,
          },
        );
        return true;
      });
      return result ? res.json({ success: true }) : res.status(404).json({ error: "License not found." });
    } catch (error) {
      return sendFailure(res, error, "Unable to update license status.");
    }
  });

  router.get("/admin/license-activations", requireAdmin, async (_req, res) => {
    try {
      const [activations] = await sequelize.query(
        `SELECT a."ActivationId" AS id, a."ActivatedAt" AS "activatedAt",
                a."LastValidatedAt" AS "lastValidatedAt", a."DeactivatedAt" AS "deactivatedAt",
                a."IsActive" AS "isActive", a."DeviceName" AS "deviceName",
                p."ProductName" AS "productName", ui."Email" AS "buyerEmail",
                l."LicenseId" AS "licenseId"
         FROM "LicenseActivations" a
         JOIN "Licenses" l ON l."LicenseId" = a."LicenseId"
         JOIN "Products" p ON p."ProductId" = l."ProductId"
         LEFT JOIN "UserAccounts" ua ON ua."UserId" = l."UserId"
         LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         ORDER BY a."ActivatedAt" DESC LIMIT 500`,
      );
      return res.json({ activations });
    } catch (error) {
      return sendFailure(res, error, "Unable to load license activations.");
    }
  });

  return router;
};
