const { CreatorProfile, UserAccount, UserInfo, UserRole, UserAccountRole, sequelize } = require("../models");
const { requireDatabase } = require("./authHelpers");
const { readIdentityDocument, saveIdentityDocument } = require("../services/secureIdentityDocumentService");
const { QueryTypes } = require("sequelize");

function boundedText(value, label, maximum, required = false) {
  const text = String(value || "").trim();
  if ((required && !text) || text.length > maximum) {
    throw new Error(required ? `${label} is required and must be ${maximum} characters or fewer.` : `${label} must be ${maximum} characters or fewer.`);
  }
  return text || null;
}

function pageParameters(query) {
  const page = Math.max(1, Number.parseInt(String(query.page || "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || "10"), 10) || 10));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

async function ensureCreatorRoleForUser(userId, transaction) {
  const [creatorRole] = await UserRole.findOrCreate({
    where: { RoleName: "Creator" },
    defaults: { RoleName: "Creator" },
    transaction,
  });
  const user = await UserAccount.findOne({ where: { UserId: userId }, transaction });
  if (!user) throw new Error("User account not found during approval.");

  await UserAccountRole.findOrCreate({
    where: { UserId: user.UserId, UserRoleId: creatorRole.UserRoleId },
    defaults: { UserId: user.UserId, UserRoleId: creatorRole.UserRoleId, CreatedAt: new Date() },
    transaction,
  });
}

async function applyCreatorProgram(req, res) {
  if (!requireDatabase(res, sequelize)) return;

  let application;
  try {
    const user = await UserAccount.findOne({
      where: { UserId: req.userId },
      include: [{ model: UserInfo, as: "info" }],
    });
    if (!user) return res.status(404).json({ error: "User account not found." });

    const legalName = boundedText(req.body.fullLegalName || req.body.fullName || user.info?.FullName, "Full legal name", 255, true);
    const country = boundedText(req.body.country, "Country", 100, true);
    const businessOverview = boundedText(req.body.businessOverview || req.body.bio, "Business overview", 5000, true);
    const storeName = boundedText(req.body.storeName, "Store name", 150, true);
    const username = boundedText(req.body.username || user.Username, "Username", 100, true);
    const phoneNumber = boundedText(req.body.phoneNumber, "Phone number", 50);
    const websiteUrl = boundedText(req.body.websiteUrl, "Website URL", 2048);
    const bio = boundedText(req.body.bio || businessOverview, "Creator bio", 5000);
    const avatarUrl = boundedText(req.body.avatarUrl, "Avatar", 4 * 1024 * 1024);
    const bannerUrl = boundedText(req.body.bannerUrl, "Banner", 8 * 1024 * 1024);
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return res.status(400).json({ error: "Username must be 3-30 characters using only letters, numbers, and underscores." });
    }
    if (websiteUrl && !/^https?:\/\//i.test(websiteUrl)) return res.status(400).json({ error: "Website URL must begin with http:// or https://." });

    const socialLinks = req.body.socialLinks && typeof req.body.socialLinks === "object" && !Array.isArray(req.body.socialLinks)
      ? req.body.socialLinks
      : {};
    const profile = await CreatorProfile.findOne({ where: { UserId: user.UserId } });
    if (["approved", "suspended"].includes(profile?.AccountApprovalStatus)) {
      return res.status(409).json({ error: "This account is already approved or currently suspended from creator access." });
    }

    application = await sequelize.transaction(async (transaction) => {
      const [existingPending] = await sequelize.query(
        `SELECT "CreatorApplicationId" FROM "CreatorApplications"
         WHERE "UserId" = :userId AND "Status" = 'pending' LIMIT 1`,
        { replacements: { userId: user.UserId }, type: QueryTypes.SELECT, transaction },
      );
      if (existingPending) throw Object.assign(new Error("A creator application is already pending."), { statusCode: 409 });

      const [creatorProfile] = await CreatorProfile.findOrCreate({
        where: { UserId: user.UserId },
        defaults: {
          UserId: user.UserId,
          DisplayName: String(user.info?.FullName || legalName).trim(),
          Username: username,
          PhoneNumber: phoneNumber,
          Bio: bio,
          WebsiteUrl: websiteUrl,
          AvatarUrl: avatarUrl,
          BannerUrl: bannerUrl,
          SocialLinks: socialLinks,
          AccountApprovalStatus: "pending",
          IdentityVerificationStatus: "unverified",
          IsVerified: false,
          IsActive: false,
        },
        transaction,
      });
      await creatorProfile.update({
        DisplayName: String(user.info?.FullName || legalName).trim(),
        Username: username,
        PhoneNumber: phoneNumber,
        Bio: bio,
        WebsiteUrl: websiteUrl,
        AvatarUrl: avatarUrl,
        BannerUrl: bannerUrl,
        SocialLinks: socialLinks,
        AccountApprovalStatus: "pending",
        IsActive: false,
      }, { transaction });

      const rows = await sequelize.query(
        `INSERT INTO "CreatorApplications"
          ("UserId", "FullLegalName", "Country", "BusinessOverview", "StoreName", "Username", "PhoneNumber", "WebsiteUrl", "Bio", "AvatarUrl", "BannerUrl", "SocialLinks")
         VALUES (:userId, :legalName, :country, :businessOverview, :storeName, :username, :phoneNumber, :websiteUrl, :bio, :avatarUrl, :bannerUrl, CAST(:socialLinks AS jsonb))
         RETURNING "CreatorApplicationId" AS id, "Status" AS status, "SubmittedAt" AS "submittedAt"`,
        {
          replacements: {
            userId: user.UserId,
            legalName,
            country,
            businessOverview,
            storeName,
            username,
            phoneNumber,
            websiteUrl,
            bio,
            avatarUrl,
            bannerUrl,
            socialLinks: JSON.stringify(socialLinks),
          },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const created = rows[0];
      await sequelize.query(
        `INSERT INTO "CreatorApplicationEvents" ("CreatorApplicationId", "ActorUserId", "NewStatus")
         VALUES (:applicationId, :userId, 'pending')`,
        { replacements: { applicationId: created.id, userId: user.UserId }, transaction },
      );
      return created;
    });

    return res.status(201).json({ application });
  } catch (error) {
    if (error.statusCode === 409) return res.status(409).json({ error: error.message });
    if (error.name === "SequelizeUniqueConstraintError") return res.status(409).json({ error: "A creator profile already exists for this username." });
    if (error.message && /required|characters|Username|URL/.test(error.message)) return res.status(400).json({ error: error.message });
    console.error("Creator program application failed", error);
    return res.status(500).json({ error: "Unable to submit creator application." });
  }
}

async function getCreatorApplication(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  try {
    const [rows] = await sequelize.query(
      `SELECT "CreatorApplicationId" AS id, "FullLegalName" AS "fullLegalName",
              "Country" AS country, "BusinessOverview" AS "businessOverview",
              "StoreName" AS "storeName", "Username" AS username,
              "PhoneNumber" AS "phoneNumber", "WebsiteUrl" AS "websiteUrl", "Bio" AS bio,
              "Status" AS status,
              "ReviewReason" AS "reviewReason", "SubmittedAt" AS "submittedAt", "ReviewedAt" AS "reviewedAt"
       FROM "CreatorApplications" WHERE "UserId" = :userId
       ORDER BY "SubmittedAt" DESC, "CreatorApplicationId" DESC LIMIT 1`,
      { replacements: { userId: req.userId } },
    );
    const profile = await CreatorProfile.findOne({ where: { UserId: req.userId } });
    return res.json({
      application: rows[0] || null,
      accountApprovalStatus: profile?.AccountApprovalStatus || "not_applied",
    });
  } catch (error) {
    console.error("Creator application status lookup failed", error);
    return res.status(500).json({ error: "Unable to load creator application status." });
  }
}

async function listCreatorApplications(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const { page, pageSize, offset } = pageParameters(req.query);
  const search = String(req.query.search || "").trim().slice(0, 200);
  const status = String(req.query.status || "").trim().toLowerCase();
  if (status && !["pending", "approved", "rejected", "suspended", "withdrawn"].includes(status)) {
    return res.status(400).json({ error: "Invalid creator application status filter." });
  }
  const predicates = [];
  const replacements = { limit: pageSize, offset };
  if (search) {
    predicates.push('(ca."FullLegalName" ILIKE :search OR ca."StoreName" ILIKE :search OR ui."Email" ILIKE :search OR CAST(ca."CreatorApplicationId" AS text) = :exactId)');
    replacements.search = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    replacements.exactId = search;
  }
  if (status) {
    predicates.push('ca."Status" = :status');
    replacements.status = status;
  }
  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  try {
    const [countRows, rows] = await Promise.all([
      sequelize.query(
        `SELECT COUNT(*)::int AS total FROM "CreatorApplications" ca
         JOIN "UserAccounts" ua ON ua."UserId" = ca."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId" ${where}`,
        { replacements },
      ),
      sequelize.query(
        `SELECT ca."CreatorApplicationId" AS id, ca."UserId" AS "userId",
                ca."FullLegalName" AS "fullLegalName", ca."Country" AS country,
                ca."BusinessOverview" AS "businessOverview", ca."StoreName" AS "storeName",
                ca."Username" AS username, ca."PhoneNumber" AS "phoneNumber",
                ca."WebsiteUrl" AS "websiteUrl", ca."Bio" AS bio, ca."Status" AS status,
                ca."ReviewReason" AS "reviewReason", ca."SubmittedAt" AS "submittedAt",
                ca."ReviewedAt" AS "reviewedAt", ui."Email" AS email
         FROM "CreatorApplications" ca
         JOIN "UserAccounts" ua ON ua."UserId" = ca."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         ${where} ORDER BY ca."SubmittedAt" DESC LIMIT :limit OFFSET :offset`,
        { replacements },
      ),
    ]);
    const total = Number(countRows[0][0]?.total || 0);
    return res.json({ applications: rows[0], pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) } });
  } catch (error) {
    console.error("Creator application list failed", error);
    return res.status(500).json({ error: "Unable to load creator applications." });
  }
}

async function reviewCreatorApplication(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const applicationId = Number(req.params.applicationId);
  const status = String(req.body.status || "").trim().toLowerCase();
  let reason;
  try {
    if (!Number.isSafeInteger(applicationId) || applicationId <= 0) return res.status(400).json({ error: "A valid application ID is required." });
    if (!["approved", "rejected", "suspended"].includes(status)) return res.status(400).json({ error: "Choose approved, rejected, or suspended." });
    reason = boundedText(req.body.reason, "Review reason", 1000, status !== "approved");
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const application = await sequelize.transaction(async (transaction) => {
      const rows = await sequelize.query(
        `SELECT "CreatorApplicationId" AS id, "UserId" AS "userId", "Status" AS status,
                "FullLegalName" AS "fullLegalName", "StoreName" AS "storeName", "Username" AS username,
                "PhoneNumber" AS "phoneNumber", "WebsiteUrl" AS "websiteUrl", "Bio" AS bio,
                "AvatarUrl" AS "avatarUrl", "BannerUrl" AS "bannerUrl", "SocialLinks" AS "socialLinks"
         FROM "CreatorApplications" WHERE "CreatorApplicationId" = :applicationId FOR UPDATE`,
        { replacements: { applicationId }, type: QueryTypes.SELECT, transaction },
      );
      const current = rows[0];
      if (!current) throw Object.assign(new Error("Creator application not found."), { statusCode: 404 });
      const permittedTransition = (current.status === "pending" && ["approved", "rejected"].includes(status))
        || (current.status === "approved" && status === "suspended")
        || (current.status === "suspended" && status === "approved");
      if (!permittedTransition) {
        throw Object.assign(new Error("This creator application cannot be changed from its current status."), { statusCode: 409 });
      }

      await sequelize.query(
        `UPDATE "CreatorApplications" SET "Status" = :status, "ReviewReason" = :reason,
                "ReviewedByUserId" = :reviewerId, "ReviewedAt" = CURRENT_TIMESTAMP, "UpdatedAt" = CURRENT_TIMESTAMP
         WHERE "CreatorApplicationId" = :applicationId`,
        { replacements: { applicationId, status, reason, reviewerId: req.userId }, transaction },
      );
      await sequelize.query(
        `INSERT INTO "CreatorApplicationEvents" ("CreatorApplicationId", "ActorUserId", "PreviousStatus", "NewStatus", "Reason")
         VALUES (:applicationId, :reviewerId, :previousStatus, :status, :reason)`,
        { replacements: { applicationId, reviewerId: req.userId, previousStatus: current.status, status, reason }, transaction },
      );

      const profile = await CreatorProfile.findOne({ where: { UserId: current.userId }, transaction });
      if (!profile) throw new Error("Creator profile for this application was not found.");
      await profile.update({
        AccountApprovalStatus: status,
        IsActive: status === "approved",
        DisplayName: current.fullLegalName,
        Username: current.username,
        PhoneNumber: current.phoneNumber,
        WebsiteUrl: current.websiteUrl,
        AvatarUrl: current.avatarUrl,
        BannerUrl: current.bannerUrl,
        Bio: current.bio,
        SocialLinks: current.socialLinks || {},
      }, { transaction });
      if (status === "approved") await ensureCreatorRoleForUser(current.userId, transaction);
      return { id: applicationId, userId: current.userId, status, reason };
    });
    return res.json({ application });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error("Creator application review failed", error);
    return res.status(500).json({ error: "Unable to review creator application." });
  }
}

async function getCreatorVerificationStatus(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  try {
    const profile = await CreatorProfile.findOne({ where: { UserId: req.userId } });
    if (!profile || profile.AccountApprovalStatus !== "approved") {
      return res.status(403).json({ error: "Only approved creators can request identity verification." });
    }
    const [rows] = await sequelize.query(
      `SELECT "CreatorVerificationApplicationId" AS id, "Status" AS status,
              "ReviewReason" AS "reviewReason", "SubmittedAt" AS "submittedAt", "ReviewedAt" AS "reviewedAt"
       FROM "CreatorVerificationApplications" WHERE "UserId" = :userId
       ORDER BY "SubmittedAt" DESC, "CreatorVerificationApplicationId" DESC LIMIT 1`,
      { replacements: { userId: req.userId } },
    );
    return res.json({ verification: rows[0] || null, status: profile.IdentityVerificationStatus, verified: profile.IsVerified });
  } catch (error) {
    console.error("Creator verification status lookup failed", error);
    return res.status(500).json({ error: "Unable to load identity verification status." });
  }
}

async function submitCreatorVerification(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  let legalName;
  let country;
  try {
    legalName = decodeURIComponent(String(req.headers["x-full-legal-name"] || "")).trim();
    country = decodeURIComponent(String(req.headers["x-country"] || "")).trim();
  } catch {
    return res.status(400).json({ error: "Legal name or country contains invalid encoding." });
  }
  const documentType = String(req.headers["x-document-type"] || "").trim().toLowerCase();
  if (!buffer.length || !legalName || !country || !["passport", "national_id", "drivers_license"].includes(documentType)) {
    return res.status(400).json({ error: "A legal name, country, supported document type, and identity document are required." });
  }
  if (legalName.length > 255 || country.length > 100) return res.status(400).json({ error: "Legal name or country exceeds the allowed length." });

  let savedDocument;
  try {
    const profile = await CreatorProfile.findOne({ where: { UserId: req.userId } });
    if (!profile || profile.AccountApprovalStatus !== "approved" || !profile.IsActive) {
      return res.status(403).json({ error: "Only approved creators can request identity verification." });
    }
    const [pending] = await sequelize.query(
      `SELECT "CreatorVerificationApplicationId" FROM "CreatorVerificationApplications"
       WHERE "UserId" = :userId AND "Status" = 'pending' LIMIT 1`,
      { replacements: { userId: req.userId }, type: QueryTypes.SELECT },
    );
    if (pending) return res.status(409).json({ error: "An identity verification request is already pending." });

    savedDocument = await saveIdentityDocument(buffer, req.headers["content-type"]);
    const verification = await sequelize.transaction(async (transaction) => {
      const rows = await sequelize.query(
        `INSERT INTO "CreatorVerificationApplications"
          ("UserId", "FullLegalName", "Country", "DocumentType", "DocumentStorageKey", "DocumentMimeType", "DocumentSize")
         VALUES (:userId, :legalName, :country, :documentType, :storageKey, :mimeType, :size)
         RETURNING "CreatorVerificationApplicationId" AS id, "Status" AS status, "SubmittedAt" AS "submittedAt"`,
        { replacements: { userId: req.userId, legalName, country, documentType, ...savedDocument }, type: QueryTypes.SELECT, transaction },
      );
      const created = rows[0];
      await sequelize.query(
        `INSERT INTO "CreatorVerificationEvents" ("CreatorVerificationApplicationId", "ActorUserId", "NewStatus")
         VALUES (:applicationId, :userId, 'pending')`,
        { replacements: { applicationId: created.id, userId: req.userId }, transaction },
      );
      await profile.update({ IdentityVerificationStatus: "pending", IsVerified: false }, { transaction });
      return created;
    });
    return res.status(201).json({ verification });
  } catch (error) {
    if (savedDocument) {
      try {
        const { deleteIdentityDocument } = require("../services/secureIdentityDocumentService");
        await deleteIdentityDocument(savedDocument.storageKey);
      } catch (cleanupError) {
        console.error("Unable to remove unreferenced identity document", cleanupError);
      }
    }
    if (error.message && /identity documents|valid PDF|encryption/.test(error.message)) return res.status(400).json({ error: error.message });
    if (error.original?.code === "23505") return res.status(409).json({ error: "An identity verification request is already pending." });
    console.error("Identity verification submission failed", error);
    return res.status(500).json({ error: "Unable to submit identity verification." });
  }
}

async function listCreatorVerifications(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const { page, pageSize, offset } = pageParameters(req.query);
  const status = String(req.query.status || "").trim().toLowerCase();
  if (status && !["pending", "additional_info_required", "verified", "rejected", "revoked", "withdrawn"].includes(status)) {
    return res.status(400).json({ error: "Invalid identity verification status filter." });
  }
  const search = String(req.query.search || "").trim().slice(0, 200);
  const predicates = [];
  const replacements = { limit: pageSize, offset };
  if (status) {
    predicates.push('cv."Status" = :status');
    replacements.status = status;
  }
  if (search) {
    predicates.push('(cv."FullLegalName" ILIKE :search OR ui."Email" ILIKE :search OR CAST(cv."CreatorVerificationApplicationId" AS text) = :exactId)');
    replacements.search = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    replacements.exactId = search;
  }
  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  try {
    const [countRows, rows] = await Promise.all([
      sequelize.query(
        `SELECT COUNT(*)::int AS total FROM "CreatorVerificationApplications" cv
         JOIN "UserAccounts" ua ON ua."UserId" = cv."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId" ${where}`,
        { replacements },
      ),
      sequelize.query(
        `SELECT cv."CreatorVerificationApplicationId" AS id, cv."UserId" AS "userId",
                cv."FullLegalName" AS "fullLegalName", cv."Country" AS country,
                cv."DocumentType" AS "documentType", cv."DocumentMimeType" AS "documentMimeType",
                cv."DocumentSize" AS "documentSize", cv."Status" AS status,
                cv."ReviewReason" AS "reviewReason", cv."SubmittedAt" AS "submittedAt",
                ui."Email" AS email
         FROM "CreatorVerificationApplications" cv
         JOIN "UserAccounts" ua ON ua."UserId" = cv."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         ${where} ORDER BY cv."SubmittedAt" DESC LIMIT :limit OFFSET :offset`,
        { replacements },
      ),
    ]);
    const total = Number(countRows[0][0]?.total || 0);
    return res.json({ verifications: rows[0], pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) } });
  } catch (error) {
    console.error("Creator verification list failed", error);
    return res.status(500).json({ error: "Unable to load identity verification requests." });
  }
}

async function reviewCreatorVerification(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const applicationId = Number(req.params.applicationId);
  const status = String(req.body.status || "").trim().toLowerCase();
  let reason;
  try {
    if (!Number.isSafeInteger(applicationId) || applicationId <= 0) return res.status(400).json({ error: "A valid verification ID is required." });
    if (!["verified", "rejected", "additional_info_required", "revoked"].includes(status)) {
      return res.status(400).json({ error: "Choose verified, rejected, additional info required, or revoked." });
    }
    reason = boundedText(req.body.reason, "Review reason", 1000, status !== "verified");
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const verification = await sequelize.transaction(async (transaction) => {
      const rows = await sequelize.query(
        `SELECT "CreatorVerificationApplicationId" AS id, "UserId" AS "userId", "Status" AS status
         FROM "CreatorVerificationApplications" WHERE "CreatorVerificationApplicationId" = :applicationId FOR UPDATE`,
        { replacements: { applicationId }, type: QueryTypes.SELECT, transaction },
      );
      const current = rows[0];
      if (!current) throw Object.assign(new Error("Identity verification request not found."), { statusCode: 404 });
      if (current.status !== "pending" && !(status === "revoked" && current.status === "verified")) {
        throw Object.assign(new Error("This identity verification request cannot be changed from its current status."), { statusCode: 409 });
      }
      await sequelize.query(
        `UPDATE "CreatorVerificationApplications" SET "Status" = :status, "ReviewReason" = :reason,
                "ReviewedByUserId" = :reviewerId, "ReviewedAt" = CURRENT_TIMESTAMP, "UpdatedAt" = CURRENT_TIMESTAMP
         WHERE "CreatorVerificationApplicationId" = :applicationId`,
        { replacements: { applicationId, status, reason, reviewerId: req.userId }, transaction },
      );
      await sequelize.query(
        `INSERT INTO "CreatorVerificationEvents" ("CreatorVerificationApplicationId", "ActorUserId", "PreviousStatus", "NewStatus", "Reason")
         VALUES (:applicationId, :reviewerId, :previousStatus, :status, :reason)`,
        { replacements: { applicationId, reviewerId: req.userId, previousStatus: current.status, status, reason }, transaction },
      );
      const profile = await CreatorProfile.findOne({ where: { UserId: current.userId }, transaction });
      if (!profile || profile.AccountApprovalStatus !== "approved") throw new Error("An approved creator profile was not found.");
      await profile.update({ IdentityVerificationStatus: status, IsVerified: status === "verified" }, { transaction });
      return { id: applicationId, userId: current.userId, status, reason };
    });
    return res.json({ verification });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error("Identity verification review failed", error);
    return res.status(500).json({ error: "Unable to review identity verification." });
  }
}

async function getCreatorVerificationDocument(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const applicationId = Number(req.params.applicationId);
  if (!Number.isSafeInteger(applicationId) || applicationId <= 0) return res.status(400).json({ error: "A valid verification ID is required." });
  try {
    const rows = await sequelize.query(
      `SELECT "DocumentStorageKey" AS key, "DocumentMimeType" AS "mimeType"
       FROM "CreatorVerificationApplications"
       WHERE "CreatorVerificationApplicationId" = :applicationId AND "Status" IN ('pending', 'additional_info_required') LIMIT 1`,
      { replacements: { applicationId }, type: QueryTypes.SELECT },
    );
    if (!rows[0]) return res.status(404).json({ error: "Pending identity document not found." });
    const document = await readIdentityDocument(rows[0].key);
    res.set({
      "Cache-Control": "no-store, private",
      "Content-Disposition": `attachment; filename="identity-document.${document.mimeType === "application/pdf" ? "pdf" : "bin"}"`,
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    return res.send(document.buffer);
  } catch (error) {
    if (error.code === "ENOENT") return res.status(404).json({ error: "Identity document is no longer available." });
    console.error("Identity document retrieval failed", error);
    return res.status(500).json({ error: "Unable to retrieve the identity document." });
  }
}

async function approveCreatorProfile(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const userId = Number(req.body?.userId ?? req.params?.userId ?? 0);
  if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).json({ error: "A valid user ID is required." });
  try {
    const rows = await sequelize.query(
      `SELECT "CreatorApplicationId" AS id FROM "CreatorApplications"
       WHERE "UserId" = :userId AND "Status" = 'pending'
       ORDER BY "SubmittedAt" DESC LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    if (!rows[0]) return res.status(404).json({ error: "Pending creator application not found." });
    req.params.applicationId = String(rows[0].id);
    req.body = { status: "approved" };
    return reviewCreatorApplication(req, res);
  } catch (error) {
    console.error("Creator approval failed", error);
    return res.status(500).json({ error: "Unable to approve this creator account." });
  }
}

module.exports = {
  applyCreatorProgram,
  approveCreatorProfile,
  getCreatorApplication,
  getCreatorVerificationStatus,
  getCreatorVerificationDocument,
  listCreatorApplications,
  listCreatorVerifications,
  reviewCreatorApplication,
  reviewCreatorVerification,
  submitCreatorVerification,
};
