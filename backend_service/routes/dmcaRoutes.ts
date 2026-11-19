const crypto = require("crypto");
const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { sequelize } = require("../models");

const router = express.Router();
const evidenceDirectory = path.resolve(__dirname, "../uploads/dmca-private");
const allowedEvidenceTypes = new Set(["application/pdf", "image/jpeg", "image/png", "text/plain"]);
const maxEvidenceBytes = 10 * 1024 * 1024;
const caseStatuses = new Set([
  "Submitted", "Under Review", "Additional Information Required", "Approved",
  "Rejected", "Takedown Requested", "Content Disabled", "Counter-Notice Submitted",
  "Restoration Pending", "Restored", "Closed",
]);

function text(value, label, maxLength = 10000) {
  const result = String(value || "").trim();
  if (!result || result.length > maxLength) throw new Error(`${label} is required and must be at most ${maxLength} characters.`);
  return result;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

function cleanFilename(value) {
  return path.basename(String(value || "evidence")).replace(/[^\w.-]/g, "_").slice(0, 255) || "evidence";
}

function decodeEvidence(item) {
  const mimeType = String(item?.mimeType || "").toLowerCase();
  const originalName = cleanFilename(item?.name);
  const encoded = String(item?.base64 || "");
  if (!allowedEvidenceTypes.has(mimeType)) throw new Error("Evidence must be a PDF, PNG, JPEG, or plain-text file.");
  if (!encoded || encoded.length > Math.ceil(maxEvidenceBytes * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("Evidence file is empty, invalid, or exceeds the 10 MB limit.");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > maxEvidenceBytes || buffer.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new Error("Evidence file is empty, invalid, or exceeds the 10 MB limit.");
  }
  const validSignature =
    (mimeType === "application/pdf" && buffer.subarray(0, 5).toString() === "%PDF-") ||
    (mimeType === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mimeType === "image/jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (mimeType === "text/plain" && !buffer.includes(0));
  if (!validSignature) throw new Error("Evidence file content does not match its declared file type.");
  return { buffer, mimeType, originalName };
}

async function hasReviewerRole(userId) {
  const [rows] = await sequelize.query(
    `SELECT 1
     WHERE EXISTS (
       SELECT 1
       FROM "UserAccountRoles" uar
       JOIN "UsersRoles" ur ON ur."UserRoleId" = uar."UserRoleId"
       WHERE uar."UserId" = :userId
         AND lower(ur."RoleName") IN ('admin', 'superadmin', 'content reviewer', 'reviewer')
     ) OR EXISTS (
       SELECT 1
       FROM "UserAccounts" ua
       JOIN "UsersRoles" ur ON ur."UserRoleId" = ua."RoleId"
       WHERE ua."UserId" = :userId
         AND lower(ur."RoleName") IN ('admin', 'superadmin', 'content reviewer', 'reviewer')
     )
     LIMIT 1`,
    { replacements: { userId } },
  );
  return Boolean(rows[0]);
}

async function isCaseParticipant(caseId, userId) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM "DMCACases" c
     WHERE c."DMCACaseId" = :caseId
       AND (c."ReporterUserId" = :userId OR c."CreatorUserId" = :userId)
     LIMIT 1`,
    { replacements: { caseId, userId } },
  );
  return Boolean(rows[0]);
}

async function isCaseCreator(caseId, userId) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM "DMCACases"
     WHERE "DMCACaseId" = :caseId AND "CreatorUserId" = :userId`,
    { replacements: { caseId, userId } },
  );
  return Boolean(rows[0]);
}

async function canReview(req) {
  return Boolean(req.userId && await hasReviewerRole(req.userId));
}

function sendFailure(res, error, message) {
  console.error(message, error);
  return res.status(500).json({ error: message });
}

async function saveEvidence(caseId, uploadedByUserId, item, transaction = undefined) {
  const { buffer, mimeType, originalName } = decodeEvidence(item);
  await fs.mkdir(evidenceDirectory, { recursive: true });
  const storageKey = `${crypto.randomUUID()}`;
  const filePath = path.join(evidenceDirectory, storageKey);
  await fs.writeFile(filePath, buffer, { flag: "wx", mode: 0o600 });
  try {
    await sequelize.query(
      `INSERT INTO "DMCAEvidence"
         ("DMCACaseId", "UploadedByUserId", "StorageKey", "OriginalName", "MimeType", "FileSize", "Sha256")
       VALUES (:caseId, :userId, :storageKey, :name, :mimeType, :fileSize, :sha256)`,
      {
        replacements: {
          caseId,
          userId: uploadedByUserId,
          storageKey,
          name: originalName,
          mimeType,
          fileSize: buffer.length,
          sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        },
        transaction,
      },
    );
  } catch (error) {
    await fs.unlink(filePath);
    throw error;
  }
}

module.exports = function createDMCARoutes({ requireUser, findByToken }) {
  router.post("/dmca/cases", async (req, res) => {
    let reporterUserId = null;
    const authorization = req.headers.authorization || "";
    if (authorization.startsWith("Bearer ")) {
      try {
        const user = await findByToken(authorization.slice(7));
        if (user) reporterUserId = user.UserId;
        else return res.status(401).json({ error: "Invalid or expired session." });
      } catch {
        return res.status(401).json({ error: "Invalid or expired session." });
      }
    }

    try {
      const reporterName = text(req.body?.reporterName, "Reporter name", 255);
      const reporterEmail = text(req.body?.reporterEmail, "Reporter email", 320);
      if (!validEmail(reporterEmail)) return res.status(400).json({ error: "Enter a valid reporter email address." });
      const productId = Number(req.body?.productId);
      if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: "Select a valid reported product." });
      const originalWork = text(req.body?.originalWork, "Original work", 10000);
      const infringementDetails = text(req.body?.infringementDetails, "Infringement details", 10000);
      if (req.body?.goodFaithConfirmed !== true || req.body?.legalDeclarationConfirmed !== true) {
        return res.status(400).json({ error: "Confirm the good-faith and legal declarations before submitting." });
      }
      const evidence = Array.isArray(req.body?.evidence) ? req.body.evidence : [];
      if (evidence.length > 5) return res.status(400).json({ error: "A case can include at most five evidence files." });
      const [product] = await sequelize.query(
        `SELECT p."ProductId", cp."UserId" AS "creatorUserId"
         FROM "Products" p
         JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
         JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
         WHERE p."ProductId" = :productId`,
        { replacements: { productId } },
      );
      if (!product) return res.status(404).json({ error: "Reported product not found." });

      const result = await sequelize.transaction(async (transaction) => {
        const [created] = await sequelize.query(
          `INSERT INTO "DMCACases"
             ("ProductId", "ReporterUserId", "CreatorUserId", "ReporterName", "ReporterEmail",
              "OriginalWork", "InfringementDetails", "GoodFaithDeclaration", "LegalDeclaration", "Status")
           VALUES (:productId, :reporterUserId, :creatorUserId, :reporterName, :reporterEmail,
              :originalWork, :infringementDetails, :goodFaith, :legalDeclaration, 'Submitted')
           RETURNING "DMCACaseId" AS id, "UUID" AS uuid`,
          {
            replacements: {
              productId,
              reporterUserId,
              creatorUserId: product.creatorUserId,
              reporterName,
              reporterEmail,
              originalWork,
              infringementDetails,
              goodFaith: "I have a good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.",
              legalDeclaration: "I declare under penalty of perjury that the information in this notice is accurate and that I am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.",
            },
            transaction,
          },
        );
        await sequelize.query(
          `INSERT INTO "DMCAStatusHistory" ("DMCACaseId", "ActorUserId", "NewStatus", "Reason")
           VALUES (:caseId, :actorId, 'Submitted', 'Copyright report submitted.')`,
          { replacements: { caseId: created.id, actorId: reporterUserId }, transaction },
        );
        await sequelize.query(
          `INSERT INTO "DMCANotifications" ("DMCACaseId", "RecipientUserId", "Message")
           VALUES (:caseId, :creatorUserId, 'A copyright report has been submitted for one of your products.')`,
          { replacements: { caseId: created.id, creatorUserId: product.creatorUserId }, transaction },
        );
        await sequelize.query(
          `INSERT INTO "ActivityLogs"
             ("UserId", "Action", "EntityType", "EntityId", "Description")
           VALUES (:userId, 'dmca.report_submitted', 'DMCACase', :caseId, 'A copyright report was submitted.')`,
          { replacements: { userId: reporterUserId, caseId: created.id }, transaction },
        );
        for (const file of evidence) await saveEvidence(created.id, reporterUserId, file, transaction);
        return created;
      });
      return res.status(201).json({ case: result });
    } catch (error) {
      if (error.message?.includes("required") || error.message?.includes("Evidence")) {
        return res.status(400).json({ error: error.message });
      }
      return sendFailure(res, error, "Unable to submit the copyright report.");
    }
  });

  router.get("/reviewer/dmca/cases", requireUser, async (req, res) => {
    if (!(await canReview(req))) return res.status(403).json({ error: "Reviewer access required." });
    try {
      const search = `%${String(req.query.search || "").trim()}%`;
      const [cases] = await sequelize.query(
        `SELECT c."DMCACaseId" AS id, c."UUID" AS uuid, c."ProductId" AS "productId",
                c."ReporterName" AS "reporterName", c."ReporterEmail" AS "reporterEmail",
                c."InfringementDetails" AS "infringementDetails", c."Status" AS status,
                c."RequestedInformation" AS "requestedInformation",
                c."ResolutionReason" AS "resolutionReason",
                c."RestorationNotBefore" AS "restorationNotBefore", c."CreatedAt" AS "createdAt",
                p."ProductName" AS "productName", cp."UserId" AS "creatorUserId"
         FROM "DMCACases" c
         LEFT JOIN "Products" p ON p."ProductId" = c."ProductId"
         LEFT JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
         LEFT JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
         WHERE (c."UUID"::text ILIKE :search OR c."ReporterName" ILIKE :search OR c."ReporterEmail" ILIKE :search
                OR COALESCE(p."ProductName", '') ILIKE :search OR c."Status" ILIKE :search)
         ORDER BY c."CreatedAt" DESC LIMIT 300`,
        { replacements: { search } },
      );
      return res.json({ cases });
    } catch (error) {
      return sendFailure(res, error, "Unable to load copyright cases.");
    }
  });

  router.post("/dmca/cases/lookup", async (req, res) => {
    const caseReference = String(req.body?.caseReference || "").trim();
    const reporterEmail = String(req.body?.reporterEmail || "").trim().toLowerCase();
    if (!caseReference || !validEmail(reporterEmail)) {
      return res.status(400).json({ error: "A case reference and valid reporter email are required." });
    }
    try {
      const [cases] = await sequelize.query(
        `SELECT c."UUID" AS "caseReference", c."Status" AS status,
                c."RequestedInformation" AS "requestedInformation",
                c."ResolutionReason" AS "response", c."CreatedAt" AS "createdAt",
                p."ProductName" AS "productName"
         FROM "DMCACases" c
         LEFT JOIN "Products" p ON p."ProductId" = c."ProductId"
         WHERE c."UUID" = :caseReference AND lower(c."ReporterEmail") = :reporterEmail`,
        { replacements: { caseReference, reporterEmail } },
      );
      if (!cases[0]) return res.status(404).json({ error: "No copyright case matched those details." });
      const [history] = await sequelize.query(
        `SELECT "NewStatus" AS status, "Reason" AS response, "CreatedAt" AS "createdAt"
         FROM "DMCAStatusHistory"
         WHERE "DMCACaseId" = (SELECT "DMCACaseId" FROM "DMCACases" WHERE "UUID" = :caseReference)
         ORDER BY "CreatedAt"`,
        { replacements: { caseReference } },
      );
      return res.json({ case: cases[0], history });
    } catch (error) {
      return sendFailure(res, error, "Unable to look up this copyright case.");
    }
  });

  router.get("/dmca/cases/mine", requireUser, async (req, res) => {
    try {
      const [cases] = await sequelize.query(
        `SELECT c."DMCACaseId" AS id, c."UUID" AS uuid, c."Status" AS status,
                c."CreatedAt" AS "createdAt", c."UpdatedAt" AS "updatedAt",
                c."ResolutionReason" AS "resolutionReason", p."ProductName" AS "productName"
         FROM "DMCACases" c LEFT JOIN "Products" p ON p."ProductId" = c."ProductId"
         WHERE c."ReporterUserId" = :userId ORDER BY c."CreatedAt" DESC`,
        { replacements: { userId: req.userId } },
      );
      return res.json({ cases });
    } catch (error) {
      return sendFailure(res, error, "Unable to load submitted copyright reports.");
    }
  });

  router.get("/creator/dmca/cases", requireUser, async (req, res) => {
    try {
      const [cases] = await sequelize.query(
        `SELECT c."DMCACaseId" AS id, c."UUID" AS uuid, c."Status" AS status,
                c."CreatedAt" AS "createdAt", c."InfringementDetails" AS "infringementDetails",
                c."RequestedInformation" AS "requestedInformation",
                c."ResolutionReason" AS "resolutionReason", p."ProductName" AS "productName",
                c."ReporterName" AS "reporterName"
         FROM "DMCACases" c JOIN "Products" p ON p."ProductId" = c."ProductId"
         JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
         JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
         WHERE cp."UserId" = :userId ORDER BY c."CreatedAt" DESC`,
        { replacements: { userId: req.userId } },
      );
      return res.json({ cases });
    } catch (error) {
      return sendFailure(res, error, "Unable to load complaints against your products.");
    }
  });

  router.get("/dmca/notifications", requireUser, async (req, res) => {
    try {
      const [notifications] = await sequelize.query(
        `SELECT n."DMCANotificationId" AS id, n."DMCACaseId" AS "caseId",
                n."Message" AS message, n."CreatedAt" AS "createdAt"
         FROM "DMCANotifications" n
         WHERE n."RecipientUserId" = :userId
         ORDER BY n."CreatedAt" DESC LIMIT 100`,
        { replacements: { userId: req.userId } },
      );
      return res.json({ notifications });
    } catch (error) {
      return sendFailure(res, error, "Unable to load copyright notifications.");
    }
  });

  router.get("/dmca/cases/:id", requireUser, async (req, res) => {
    try {
      if (!(await canReview(req)) && !(await isCaseParticipant(req.params.id, req.userId))) {
        return res.status(403).json({ error: "You cannot access this copyright case." });
      }
      const [cases] = await sequelize.query(
        `SELECT c."DMCACaseId" AS id, c."UUID" AS uuid, c."ProductId" AS "productId",
                c."ReporterName" AS "reporterName", c."ReporterEmail" AS "reporterEmail",
                c."OriginalWork" AS "originalWork", c."InfringementDetails" AS "infringementDetails",
                c."Status" AS status, c."RequestedInformation" AS "requestedInformation",
                c."ResolutionReason" AS "resolutionReason",
                c."RestorationNotBefore" AS "restorationNotBefore",
                p."ProductName" AS "productName"
         FROM "DMCACases" c LEFT JOIN "Products" p ON p."ProductId" = c."ProductId"
         WHERE c."DMCACaseId" = :id`,
        { replacements: { id: req.params.id } },
      );
      if (!cases[0]) return res.status(404).json({ error: "Copyright case not found." });
      const [evidence] = await sequelize.query(
        `SELECT "DMCAEvidenceId" AS id, "OriginalName" AS name, "MimeType" AS "mimeType",
                "FileSize" AS "fileSize", "CreatedAt" AS "createdAt"
         FROM "DMCAEvidence" WHERE "DMCACaseId" = :id ORDER BY "CreatedAt"`,
        { replacements: { id: req.params.id } },
      );
      const [history] = await sequelize.query(
        `SELECT h."PreviousStatus" AS "previousStatus", h."NewStatus" AS "newStatus",
                h."Reason" AS reason, h."CreatedAt" AS "createdAt", ui."Email" AS "actorEmail"
         FROM "DMCAStatusHistory" h
         LEFT JOIN "UserAccounts" ua ON ua."UserId" = h."ActorUserId"
         LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE h."DMCACaseId" = :id ORDER BY h."CreatedAt"`,
        { replacements: { id: req.params.id } },
      );
      const [counterNotices] = await sequelize.query(
        `SELECT n."Statement" AS statement, n."LegalDeclaration" AS "legalDeclaration",
                n."CreatedAt" AS "createdAt", ui."Email" AS "submitterEmail"
         FROM "DMCACounterNotices" n
         LEFT JOIN "UserAccounts" ua ON ua."UserId" = n."SubmittedByUserId"
         LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE n."DMCACaseId" = :id ORDER BY n."CreatedAt" DESC`,
        { replacements: { id: req.params.id } },
      );
      return res.json({ case: cases[0], evidence, history, counterNotices });
    } catch (error) {
      return sendFailure(res, error, "Unable to load copyright case details.");
    }
  });

  router.post("/creator/dmca/cases/:id/counter-notices", requireUser, async (req, res) => {
    try {
      if (!(await isCaseCreator(req.params.id, req.userId))) {
        return res.status(404).json({ error: "Copyright case not found." });
      }
      const statement = text(req.body?.statement, "Counter-notice statement", 10000);
      if (req.body?.legalDeclarationConfirmed !== true) {
        return res.status(400).json({ error: "Confirm the counter-notice legal declaration before submitting." });
      }
      const evidence = Array.isArray(req.body?.evidence) ? req.body.evidence : [];
      if (evidence.length > 5) return res.status(400).json({ error: "A counter-notice can include at most five evidence files." });
      const declaration = "I consent to the jurisdiction of the Federal District Court for the judicial district in which my address is located, or if outside the United States, to any judicial district in which the service provider may be found, and I will accept service of process from the person who provided the original notification or that person's agent.";
      const result = await sequelize.transaction(async (transaction) => {
        const [caseRows] = await sequelize.query(
          `SELECT "Status", "ReporterUserId", "ReporterEmail"
           FROM "DMCACases" WHERE "DMCACaseId" = :caseId FOR UPDATE`,
          { replacements: { caseId: req.params.id }, transaction },
        );
        if (!caseRows[0] || !["Content Disabled", "Takedown Requested"].includes(caseRows[0].Status)) {
          return { error: "A counter-notice can only be submitted for a takedown case." };
        }
        const [countRows] = await sequelize.query(
          `SELECT COUNT(*)::int AS count FROM "DMCAEvidence" WHERE "DMCACaseId" = :caseId`,
          { replacements: { caseId: req.params.id }, transaction },
        );
        if (Number(countRows[0].count) + evidence.length > 10) {
          return { error: "A case can include at most ten evidence files." };
        }
        const [counterRows] = await sequelize.query(
          `INSERT INTO "DMCACounterNotices" ("DMCACaseId", "SubmittedByUserId", "Statement", "LegalDeclaration")
           VALUES (:caseId, :userId, :statement, :declaration)
           RETURNING "DMCACounterNoticeId" AS id`,
          { replacements: { caseId: req.params.id, userId: req.userId, statement, declaration }, transaction },
        );
        const [updated] = await sequelize.query(
          `UPDATE "DMCACases" SET "Status" = 'Counter-Notice Submitted', "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "DMCACaseId" = :caseId RETURNING "ReporterUserId", "ReporterEmail"`,
          { replacements: { caseId: req.params.id }, transaction },
        );
        await sequelize.query(
          `INSERT INTO "DMCAStatusHistory" ("DMCACaseId", "ActorUserId", "PreviousStatus", "NewStatus", "Reason")
           VALUES (:caseId, :userId, :previousStatus, 'Counter-Notice Submitted', :reason)`,
          { replacements: { caseId: req.params.id, userId: req.userId, previousStatus: caseRows[0].Status, reason: "Creator submitted a counter-notice." }, transaction },
        );
        await sequelize.query(
          `INSERT INTO "DMCANotifications" ("DMCACaseId", "RecipientUserId", "RecipientEmail", "Message")
           VALUES (:caseId, :reporterId, :reporterEmail, :message)`,
          { replacements: { caseId: req.params.id, reporterId: updated[0].ReporterUserId, reporterEmail: updated[0].ReporterEmail, message: "A counter-notice was submitted for this copyright case." }, transaction },
        );
        await sequelize.query(
          `INSERT INTO "ActivityLogs"
             ("UserId", "Action", "EntityType", "EntityId", "Description")
           VALUES (:userId, 'dmca.counter_notice_submitted', 'DMCACase', :caseId, 'A creator submitted a copyright counter-notice.')`,
          { replacements: { userId: req.userId, caseId: req.params.id }, transaction },
        );
        for (const file of evidence) await saveEvidence(req.params.id, req.userId, file, transaction);
        return { id: counterRows[0].id };
      });
      if (result.error) return res.status(409).json({ error: result.error });
      return res.status(201).json(result);
    } catch (error) {
      if (error.message?.includes("required")) return res.status(400).json({ error: error.message });
      return sendFailure(res, error, "Unable to submit the counter-notice.");
    }
  });

  router.post("/dmca/cases/:id/evidence", requireUser, async (req, res) => {
    const file = req.body?.file;
    try {
      if (!(await canReview(req)) && !(await isCaseParticipant(req.params.id, req.userId))) {
        return res.status(403).json({ error: "You cannot add evidence to this case." });
      }
      const [countRows] = await sequelize.query(
        `SELECT COUNT(*)::int AS count FROM "DMCAEvidence" WHERE "DMCACaseId" = :id`,
        { replacements: { id: req.params.id } },
      );
      if (Number(countRows[0].count) >= 10) return res.status(400).json({ error: "A case can include at most ten evidence files." });
      const [caseRows] = await sequelize.query(
        `SELECT "DMCACaseId" FROM "DMCACases" WHERE "DMCACaseId" = :id`,
        { replacements: { id: req.params.id } },
      );
      if (!caseRows[0]) return res.status(404).json({ error: "Copyright case not found." });
      await saveEvidence(req.params.id, req.userId, file);
      return res.status(201).json({ success: true });
    } catch (error) {
      if (error.message?.includes("Evidence")) return res.status(400).json({ error: error.message });
      return sendFailure(res, error, "Unable to add evidence to the case.");
    }
  });

  router.get("/dmca/cases/:id/evidence/:evidenceId", requireUser, async (req, res) => {
    try {
      if (!(await canReview(req)) && !(await isCaseParticipant(req.params.id, req.userId))) {
        return res.status(403).json({ error: "You cannot access this evidence." });
      }
      const [rows] = await sequelize.query(
        `SELECT "StorageKey", "OriginalName", "MimeType"
         FROM "DMCAEvidence"
         WHERE "DMCACaseId" = :caseId AND "DMCAEvidenceId" = :evidenceId`,
        { replacements: { caseId: req.params.id, evidenceId: req.params.evidenceId } },
      );
      if (!rows[0]) return res.status(404).json({ error: "Evidence file not found." });
      const filePath = path.join(evidenceDirectory, rows[0].StorageKey);
      res.setHeader("Content-Type", rows[0].MimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${cleanFilename(rows[0].OriginalName)}"`);
      return res.send(await fs.readFile(filePath));
    } catch (error) {
      return sendFailure(res, error, "Unable to retrieve evidence.");
    }
  });

  router.patch("/reviewer/dmca/cases/:id", requireUser, async (req, res) => {
    if (!(await canReview(req))) return res.status(403).json({ error: "Reviewer access required." });
    const status = String(req.body?.status || "");
    const reason = String(req.body?.reason || "").trim();
    if (!caseStatuses.has(status)) return res.status(400).json({ error: "Select a valid case status." });
    if (["Approved", "Rejected", "Takedown Requested", "Content Disabled", "Closed", "Restored"].includes(status) && !reason) {
      return res.status(400).json({ error: "A documented reason is required for this decision." });
    }
    if (status === "Additional Information Required" && !String(req.body?.requestedInformation || "").trim()) {
      return res.status(400).json({ error: "Describe the additional information needed from the reporter." });
    }
    const restorationNotBefore = req.body?.restorationNotBefore
      ? new Date(req.body.restorationNotBefore)
      : null;
    if (status === "Restoration Pending" && (!restorationNotBefore || Number.isNaN(restorationNotBefore.getTime()))) {
      return res.status(400).json({ error: "Set a valid legally reviewed restoration date." });
    }
    try {
      const result = await sequelize.transaction(async (transaction) => {
        const [cases] = await sequelize.query(
          `SELECT c."DMCACaseId", c."Status", c."ProductId", c."ProductStatusBeforeTakedown",
                  c."RestorationNotBefore", c."ReporterEmail", c."ReporterUserId", c."CreatorUserId",
                  p."Status" AS "productStatus", creatorInfo."Email" AS "creatorEmail"
           FROM "DMCACases" c LEFT JOIN "Products" p ON p."ProductId" = c."ProductId"
           LEFT JOIN "UserAccounts" creator ON creator."UserId" = c."CreatorUserId"
           LEFT JOIN "UserInfo" creatorInfo ON creatorInfo."UserInfoId" = creator."UserInfoId"
           WHERE c."DMCACaseId" = :id FOR UPDATE OF c`,
          { replacements: { id: req.params.id }, transaction },
        );
        const current = cases[0];
        if (!current) return { error: "Copyright case not found.", statusCode: 404 };
        if (status === "Content Disabled") {
          if (!["Approved", "Takedown Requested", "Under Review"].includes(current.Status)) {
            return { error: "This case is not ready for a content disable action.", statusCode: 409 };
          }
          if (!current.ProductId || !current.productStatus) {
            return { error: "The reported product is no longer available.", statusCode: 409 };
          }
          await sequelize.query(
            `UPDATE "Products" SET "Status" = 'draft' WHERE "ProductId" = :productId`,
            { replacements: { productId: current.ProductId }, transaction },
          );
        }
        if (status === "Restored") {
          if (current.Status !== "Restoration Pending" || !current.RestorationNotBefore) {
            return { error: "Set the case to restoration pending with a reviewed waiting-period date before restoring content.", statusCode: 409 };
          }
          if (new Date(current.RestorationNotBefore) > new Date()) {
            return { error: "The reviewed restoration waiting period has not elapsed.", statusCode: 409 };
          }
          if (current.ProductId && current.ProductStatusBeforeTakedown) {
            await sequelize.query(
              `UPDATE "Products" SET "Status" = :productStatus WHERE "ProductId" = :productId`,
              { replacements: { productId: current.ProductId, productStatus: current.ProductStatusBeforeTakedown }, transaction },
            );
          }
        }
        const [updated] = await sequelize.query(
          `UPDATE "DMCACases"
           SET "Status" = :status,
               "ReviewerUserId" = :reviewerId,
               "RequestedInformation" = :requestedInformation,
               "ResolutionReason" = CASE WHEN :reason = '' THEN "ResolutionReason" ELSE :reason END,
               "RestorationNotBefore" = CASE WHEN :hasRestorationDate THEN :restorationNotBefore ELSE "RestorationNotBefore" END,
               "ProductStatusBeforeTakedown" = CASE
                 WHEN :status = 'Content Disabled' AND "ProductStatusBeforeTakedown" IS NULL THEN :productStatus
                 ELSE "ProductStatusBeforeTakedown" END,
               "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "DMCACaseId" = :id
           RETURNING "Status"`,
          {
            replacements: {
              id: req.params.id,
              status,
              reviewerId: req.userId,
              requestedInformation: req.body?.requestedInformation ? String(req.body.requestedInformation).slice(0, 10000) : null,
              reason,
              hasRestorationDate: Boolean(restorationNotBefore),
              restorationNotBefore,
              productStatus: current.productStatus,
            },
            transaction,
          },
        );
        await sequelize.query(
          `INSERT INTO "DMCAStatusHistory"
             ("DMCACaseId", "ActorUserId", "PreviousStatus", "NewStatus", "Reason")
           VALUES (:id, :actorId, :previousStatus, :newStatus, :reason)`,
          {
            replacements: {
              id: req.params.id,
              actorId: req.userId,
              previousStatus: current.Status,
              newStatus: updated[0].Status,
              reason,
            },
            transaction,
          },
        );
        await sequelize.query(
          `INSERT INTO "DMCANotifications" ("DMCACaseId", "RecipientUserId", "RecipientEmail", "Message")
           VALUES (:id, :creatorId, :creatorEmail, :message)`,
          {
            replacements: {
              id: req.params.id,
              creatorId: current.CreatorUserId,
              creatorEmail: current.creatorEmail,
              message: `Copyright case status updated to ${status}. ${reason}`.slice(0, 5000),
            },
            transaction,
          },
        );
        await sequelize.query(
          `INSERT INTO "ActivityLogs"
             ("UserId", "Action", "EntityType", "EntityId", "Description", "Metadata")
           VALUES (:actorId, 'dmca.case_status_changed', 'DMCACase', :caseId,
                   'A reviewer changed a copyright case status.',
                   jsonb_build_object('status', :status, 'reason', :reason))`,
          { replacements: { actorId: req.userId, caseId: req.params.id, status, reason }, transaction },
        );
        return { success: true };
      });
      if (result.error) return res.status(result.statusCode).json({ error: result.error });
      return res.json(result);
    } catch (error) {
      return sendFailure(res, error, "Unable to update copyright case.");
    }
  });

  return router;
};
