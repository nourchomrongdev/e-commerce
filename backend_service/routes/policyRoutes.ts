const express = require("express");
const { sequelize, LegalPolicy, LegalPolicyVersion, LegalPolicyAuditLog } = require("../models");
const { findByToken } = require("../controllers/authHelpers");

const router = express.Router();

function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "policy";
}

function getActorName(req) {
  const user = req.user || {};
  return String(user.FullName || user.name || user.email || "System Administrator").trim() || "System Administrator";
}

function normalizePolicyData(policy) {
  return {
    id: Number(policy.PolicyId ?? policy.id ?? 0),
    key: String(policy.PolicyKey ?? policy.key ?? ""),
    title: String(policy.Title ?? policy.title ?? ""),
    slug: String(policy.Slug ?? policy.slug ?? ""),
    category: String(policy.Category ?? policy.category ?? "general"),
    description: String(policy.Description ?? policy.description ?? ""),
    content: String(policy.Content ?? policy.content ?? ""),
    contentJson: policy.ContentJson ?? policy.contentJson ?? null,
    status: String(policy.Status ?? policy.status ?? "draft").toLowerCase(),
    version: Number(policy.Version ?? policy.version ?? 1),
    publishedVersion: Number(policy.PublishedVersion ?? policy.publishedVersion ?? 0) || null,
    createdAt: policy.CreatedAt ?? policy.createdAt ?? null,
    updatedAt: policy.UpdatedAt ?? policy.updatedAt ?? null,
    publishedAt: policy.PublishedAt ?? policy.publishedAt ?? null,
    createdBy: policy.CreatedBy ?? policy.createdBy ?? null,
    updatedBy: policy.UpdatedBy ?? policy.updatedBy ?? null,
    deletedAt: policy.DeletedAt ?? policy.deletedAt ?? null,
    versions: Array.isArray(policy.versions) ? policy.versions.map((version) => ({
      id: Number(version.PolicyVersionId ?? version.id ?? 0),
      version: Number(version.VersionNumber ?? version.version ?? 1),
      title: String(version.Title ?? version.title ?? ""),
      slug: String(version.Slug ?? version.slug ?? ""),
      category: String(version.Category ?? version.category ?? "general"),
      description: String(version.Description ?? version.description ?? ""),
      content: String(version.Content ?? version.content ?? ""),
      contentJson: version.ContentJson ?? version.contentJson ?? null,
      status: String(version.Status ?? version.status ?? "draft").toLowerCase(),
      createdBy: version.CreatedBy ?? version.createdBy ?? null,
      createdAt: version.CreatedAt ?? version.createdAt ?? null,
      publishedAt: version.PublishedAt ?? version.publishedAt ?? null,
    })) : [],
  };
}

async function sanitizePolicyPayload(body) {
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const rawContent = typeof body.content === "string" ? body.content : "<p>Start typing policy content.</p>";
  const content = rawContent
    .replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed)[^>]*\/?>/gi, "")
    .replace(/\s(on[a-z]+|formaction|srcdoc)\s*=\s*(["']).*?\2/gi, "")
    .replace(/javascript\s*:/gi, "")
  const contentJson = body.contentJson && typeof body.contentJson === "object" ? body.contentJson : null;
  const category = String(body.category || "").trim();
  let key = String(body.key || "").trim();
  if (!key) key = slugify(title || category || "policy");
  key = slugify(key);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) throw new Error("Policy slug must contain lowercase letters, numbers, and hyphens.");
  const status = String(body.status || "draft").toLowerCase();
  if (!["draft", "published", "archived"].includes(status)) throw new Error("Policy status must be draft, published, or archived.");
  if (!title || !description || !content) throw new Error("Policy title, description, and content are required.");
  return { title, description, content, contentJson, key, category: category || key, status, slug: slugify(title || key), version: Number(body.version || 1) || 1 };
}

function nextDraftVersionNumber(versions) {
  const numbers = (versions || [])
    .map((version) => Number(version.VersionNumber ?? version.version ?? 0))
    .filter((version) => Number.isFinite(version) && version >= 1);
  const latest = numbers.length ? Math.max(...numbers) : 1;
  const major = Math.floor(latest);
  const minor = Math.round((latest - major) * 10);
  if (minor >= 9) return Number((major + 1).toFixed(1));
  return Number((major + (minor + 1) / 10).toFixed(1));
}

async function recordAuditLog(policyId, action, req, metadata = null, versionId = null) {
  if (!sequelize) return null;
  try {
    await LegalPolicyAuditLog.create({
      PolicyId: Number(policyId),
      PolicyVersionId: versionId ? Number(versionId) : null,
      Action: String(action),
      ActorUserId: req.user?.UserId || null,
      ActorName: getActorName(req),
      Metadata: metadata ? JSON.stringify(metadata) : null,
      CreatedAt: new Date(),
    });
  } catch (error) {
    console.warn("Policy audit log failed:", error.message);
  }
  return true;
}

async function loadPolicyListFromDatabase(includeDrafts = true) {
  if (!sequelize || !LegalPolicy) throw new Error("Policy database is unavailable.");

  const publicCondition = includeDrafts ? {} : { Status: "published" };
  const rows = await LegalPolicy.findAll({
    where: { DeletedAt: null, ...publicCondition },
    order: [["UpdatedAt", "DESC"], ["PolicyId", "DESC"]],
    include: [{ model: LegalPolicyVersion, as: "versions", order: [["CreatedAt", "DESC"]] }],
  });

  return rows.map((row) => normalizePolicyData(row.toJSON ? row.toJSON() : row));
}

async function getPolicyByKeyOrId(keyOrId) {
  if (!sequelize || !LegalPolicy) {
    return null;
  }

  const row = await LegalPolicy.findOne({
    where: { DeletedAt: null, [sequelize.Sequelize.Op.or]: [{ PolicyKey: String(keyOrId) }, { Slug: String(keyOrId) }, { PolicyId: Number(keyOrId) || null }] },
    include: [{ model: LegalPolicyVersion, as: "versions", order: [["CreatedAt", "DESC"]] }],
  });

  return row ? normalizePolicyData(row.toJSON ? row.toJSON() : row) : null;
}

async function ensurePolicyAdmin(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    const user = await findByToken(token);
    if (!user) return res.status(401).json({ error: "User account is unavailable." });
    const roleNames = [user.role?.RoleName || user.RoleName, ...(user.roles || []).map((link) => link.role?.RoleName || link.RoleName)]
      .filter(Boolean)
      .map((role) => String(role).toLowerCase());
    if (!roleNames.includes("admin") && !roleNames.includes("superadmin")) {
      return res.status(403).json({ error: "Admin access required." });
    }
    req.userId = user.UserId;
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

router.get("/public-list", async (_req, res) => {
  try {
    if (!sequelize || !LegalPolicy) return res.status(503).json({ error: "Policy database is unavailable." });
    const rows = await LegalPolicy.findAll({
      where: { DeletedAt: null, Status: "published" },
      order: [["Title", "ASC"]],
    });
    const policies = [];
    for (const row of rows) {
      const version = row.PublishedVersion
        ? await LegalPolicyVersion.findOne({
            where: { PolicyId: row.PolicyId, VersionNumber: row.PublishedVersion, Status: "published" },
          })
        : await LegalPolicyVersion.findOne({
            where: { PolicyId: row.PolicyId, Status: "published" },
            order: [["VersionNumber", "DESC"]],
          });
      if (version) {
        policies.push({
          id: row.PolicyId,
          key: row.PolicyKey,
          title: version.Title,
          slug: version.Slug,
          href: `/legal/${encodeURIComponent(version.Slug || row.PolicyKey)}`,
          publishedAt: version.PublishedAt,
        });
      }
    }
    return res.json({ policies });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load published policies." });
  }
});

router.get("/public/:keyOrId", async (req, res) => {
  try {
    if (!sequelize || !LegalPolicy) return res.status(503).json({ error: "Policy database is unavailable." });
    const identifier = String(req.params.keyOrId);
    let row = await LegalPolicy.findOne({
      where: {
        DeletedAt: null,
        Status: "published",
        [sequelize.Sequelize.Op.or]: [
          { PolicyKey: identifier },
          { Slug: identifier },
          { PolicyId: Number(identifier) || null },
        ],
      },
    });
    if (!row) {
      const publishedVersion = await LegalPolicyVersion.findOne({
        where: { Slug: identifier, Status: "published" },
        order: [["VersionNumber", "DESC"]],
      });
      if (publishedVersion) {
        row = await LegalPolicy.findOne({
          where: {
            PolicyId: publishedVersion.PolicyId,
            DeletedAt: null,
            Status: "published",
          },
        });
      }
    }
    if (!row) return res.status(404).json({ error: "Published policy not found." });
    const version = row.PublishedVersion
      ? await LegalPolicyVersion.findOne({
          where: { PolicyId: row.PolicyId, VersionNumber: row.PublishedVersion, Status: "published" },
        })
      : await LegalPolicyVersion.findOne({
          where: { PolicyId: row.PolicyId, Status: "published" },
          order: [["VersionNumber", "DESC"]],
        });
    if (!version) return res.status(404).json({ error: "Published policy version not found." });
    return res.json({
      policy: {
        id: row.PolicyId,
        key: row.PolicyKey,
        title: version.Title,
        slug: version.Slug,
        description: version.Description,
        content: version.Content,
        contentJson: version.ContentJson,
        status: "published",
        version: version.VersionNumber,
        publishedAt: version.PublishedAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load published policy." });
  }
});

router.get("/", ensurePolicyAdmin, async (req, res) => {
  try {
    const includeDrafts = String(req.query.includeDrafts || "true").toLowerCase() === "true";
    const policies = await loadPolicyListFromDatabase(includeDrafts);
    return res.json({ policies });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load policies." });
  }
});

router.get("/:keyOrId", ensurePolicyAdmin, async (req, res) => {
  try {
    const policy = await getPolicyByKeyOrId(req.params.keyOrId);
    if (!policy) return res.status(404).json({ error: "Policy not found." });
    return res.json({ policy });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load policy." });
  }
});

router.post("/", ensurePolicyAdmin, async (req, res) => {
  try {
    const payload = await sanitizePolicyPayload(req.body || {});
    const key = payload.key;
    const now = new Date();

    if (!sequelize || !LegalPolicy) return res.status(503).json({ error: "Policy database is unavailable." });

    const duplicate = await LegalPolicy.findOne({ where: { PolicyKey: key, DeletedAt: null } });
    if (duplicate) return res.status(409).json({ error: "A policy with this key already exists." });

    const policy = await LegalPolicy.create({
      PolicyKey: key,
      Title: payload.title || "New policy",
      Slug: payload.slug,
      Category: payload.category,
      Description: payload.description,
      Content: payload.content,
      ContentJson: payload.contentJson,
      Status: payload.status,
      Version: payload.version,
      CreatedBy: req.user?.UserId || 1,
      UpdatedBy: req.user?.UserId || 1,
      CreatedAt: now,
      UpdatedAt: now,
      PublishedAt: payload.status === "published" ? now : null,
    });

    await LegalPolicyVersion.create({
      PolicyId: policy.PolicyId,
      VersionNumber: payload.version,
      Title: payload.title || "New policy",
      Slug: payload.slug,
      Category: payload.category,
      Description: payload.description,
      Content: payload.content,
      ContentJson: payload.contentJson,
      Status: payload.status,
      CreatedBy: req.user?.UserId || 1,
      CreatedAt: now,
      PublishedAt: payload.status === "published" ? now : null,
    });
    await recordAuditLog(policy.PolicyId, "policy_created", req, { key, version: payload.version }, null);
    return res.status(201).json({ policy: normalizePolicyData(policy.toJSON ? policy.toJSON() : policy) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to create policy." });
  }
});

router.put("/:id", ensurePolicyAdmin, async (req, res) => {
  try {
    const payload = await sanitizePolicyPayload(req.body || {});
    const existingKey = String(req.params.id);
    if (!sequelize || !LegalPolicy) return res.status(503).json({ error: "Policy database is unavailable." });

    const policy = await LegalPolicy.findOne({
      where: { DeletedAt: null, [sequelize.Sequelize.Op.or]: [{ PolicyId: Number(existingKey) || null }, { PolicyKey: existingKey }] },
    });
    if (!policy) return res.status(404).json({ error: "Policy not found." });

    const result = await sequelize.transaction(async (transaction) => {
      const lockedPolicy = await LegalPolicy.findByPk(policy.PolicyId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!lockedPolicy || lockedPolicy.DeletedAt) throw new Error("Policy not found.");
      let versionRecord = await LegalPolicyVersion.findOne({
        where: { PolicyId: lockedPolicy.PolicyId, Status: "draft" },
        order: [["VersionNumber", "DESC"]],
        transaction,
      });
      if (!versionRecord) {
        const versions = await LegalPolicyVersion.findAll({
          where: { PolicyId: lockedPolicy.PolicyId },
          attributes: ["VersionNumber"],
          transaction,
        });
        const nextVersion = nextDraftVersionNumber(versions);
        versionRecord = await LegalPolicyVersion.create({
          PolicyId: lockedPolicy.PolicyId,
          VersionNumber: nextVersion,
          Title: payload.title,
          Slug: payload.slug,
          Category: payload.category,
          Description: payload.description,
          Content: payload.content,
          ContentJson: payload.contentJson,
          Status: "draft",
          CreatedBy: req.user?.UserId || 1,
          CreatedAt: new Date(),
          UpdatedAt: new Date(),
        }, { transaction });
      } else {
        await versionRecord.update({
          Title: payload.title,
          Slug: payload.slug,
          Category: payload.category,
          Description: payload.description,
          Content: payload.content,
          ContentJson: payload.contentJson,
          UpdatedAt: new Date(),
        }, { transaction });
      }

      await lockedPolicy.update({
        Title: payload.title,
        Slug: payload.slug,
        Category: payload.category,
        Description: payload.description,
        Content: payload.content,
        ContentJson: payload.contentJson,
        Version: Number(versionRecord.VersionNumber),
        UpdatedAt: new Date(),
        UpdatedBy: req.user?.UserId || 1,
      }, { transaction });
      return versionRecord;
    });

    await recordAuditLog(policy.PolicyId, "policy_updated", req, { version: result.VersionNumber, status: "draft" }, result.PolicyVersionId);
    return res.json({ policy: normalizePolicyData(await getPolicyByKeyOrId(String(policy.PolicyId))) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to update policy." });
  }
});

router.post("/:id/publish", ensurePolicyAdmin, async (req, res) => {
  try {
    if (!sequelize || !LegalPolicy) return res.status(503).json({ error: "Policy database is unavailable." });
    const policy = await LegalPolicy.findOne({
      where: { DeletedAt: null, [sequelize.Sequelize.Op.or]: [{ PolicyId: Number(req.params.id) || null }, { PolicyKey: String(req.params.id) }] },
    });
    if (!policy) return res.status(404).json({ error: "Policy not found." });
    const published = await sequelize.transaction(async (transaction) => {
      const lockedPolicy = await LegalPolicy.findByPk(policy.PolicyId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!lockedPolicy || lockedPolicy.DeletedAt) throw new Error("Policy not found.");
      const draft = await LegalPolicyVersion.findOne({
        where: { PolicyId: lockedPolicy.PolicyId, Status: "draft" },
        order: [["VersionNumber", "DESC"]],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!draft) throw new Error("A draft version is required before publishing.");
      const now = new Date();
      await LegalPolicyVersion.update(
        { Status: "archived", UpdatedAt: now },
        { where: { PolicyId: lockedPolicy.PolicyId, Status: "published", PolicyVersionId: { [sequelize.Sequelize.Op.ne]: draft.PolicyVersionId } }, transaction },
      );
      await draft.update({ Status: "published", PublishedAt: now, UpdatedAt: now }, { transaction });
      await lockedPolicy.update({
        Title: draft.Title,
        Slug: draft.Slug,
        Category: draft.Category,
        Description: draft.Description,
        Content: draft.Content,
        ContentJson: draft.ContentJson,
        Status: "published",
        Version: Number(draft.VersionNumber),
        PublishedVersion: Number(draft.VersionNumber),
        UpdatedAt: now,
        UpdatedBy: req.user?.UserId || 1,
        PublishedAt: now,
      }, { transaction });
      return draft;
    });
    await recordAuditLog(policy.PolicyId, "policy_published", req, { version: published.VersionNumber }, published.PolicyVersionId);
    return res.json({ policy: normalizePolicyData(await getPolicyByKeyOrId(String(policy.PolicyId))) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to publish policy." });
  }
});

router.post("/:id/set-current/:versionId", ensurePolicyAdmin, async (req, res) => {
  try {
    if (!sequelize || !LegalPolicy || !LegalPolicyVersion) {
      return res.status(503).json({ error: "Policy database is unavailable." });
    }
    const policy = await LegalPolicy.findOne({
      where: { DeletedAt: null, [sequelize.Sequelize.Op.or]: [{ PolicyId: Number(req.params.id) || null }, { PolicyKey: String(req.params.id) }] },
    });
    if (!policy) return res.status(404).json({ error: "Policy not found." });

    const current = await sequelize.transaction(async (transaction) => {
      const lockedPolicy = await LegalPolicy.findByPk(policy.PolicyId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!lockedPolicy || lockedPolicy.DeletedAt) throw new Error("Policy not found.");
      const target = await LegalPolicyVersion.findOne({
        where: { PolicyId: lockedPolicy.PolicyId, PolicyVersionId: Number(req.params.versionId) || null },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!target) throw new Error("Version not found.");

      const now = new Date();
      await LegalPolicyVersion.update(
        { Status: "archived", UpdatedAt: now },
        { where: { PolicyId: lockedPolicy.PolicyId, Status: "published", PolicyVersionId: { [sequelize.Sequelize.Op.ne]: target.PolicyVersionId } }, transaction },
      );
      await target.update({ Status: "published", PublishedAt: now, UpdatedAt: now }, { transaction });
      await lockedPolicy.update({
        Title: target.Title,
        Slug: target.Slug,
        Category: target.Category,
        Description: target.Description,
        Content: target.Content,
        ContentJson: target.ContentJson,
        Status: "published",
        Version: Number(target.VersionNumber),
        PublishedVersion: Number(target.VersionNumber),
        PublishedAt: now,
        UpdatedAt: now,
        UpdatedBy: req.user?.UserId || 1,
      }, { transaction });
      return target;
    });

    await recordAuditLog(policy.PolicyId, "policy_set_current", req, { version: current.VersionNumber }, current.PolicyVersionId);
    return res.json({ policy: normalizePolicyData(await getPolicyByKeyOrId(String(policy.PolicyId))) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to set policy version as current." });
  }
});

router.post("/:id/unpublish", ensurePolicyAdmin, async (req, res) => {
  try {
    if (!sequelize || !LegalPolicy) return res.status(503).json({ error: "Policy database is unavailable." });
    const policy = await LegalPolicy.findOne({
      where: { DeletedAt: null, [sequelize.Sequelize.Op.or]: [{ PolicyId: Number(req.params.id) || null }, { PolicyKey: String(req.params.id) }] },
    });
    if (!policy) return res.status(404).json({ error: "Policy not found." });
    await sequelize.transaction(async (transaction) => {
      await policy.update({
        Status: "draft",
        PublishedAt: null,
        PublishedVersion: null,
        UpdatedAt: new Date(),
        UpdatedBy: req.user?.UserId || 1,
      }, { transaction });
      await LegalPolicyVersion.update(
        { Status: "draft", PublishedAt: null, UpdatedAt: new Date() },
        { where: { PolicyId: policy.PolicyId, Status: "published" }, transaction },
      );
    });
    await recordAuditLog(policy.PolicyId, "policy_unpublished", req, { key: policy.PolicyKey });
    return res.json({ policy: normalizePolicyData(await getPolicyByKeyOrId(String(policy.PolicyId))) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to unpublish policy." });
  }
});

router.post("/:id/archive", ensurePolicyAdmin, async (req, res) => {
  try {
    if (!sequelize || !LegalPolicy) return res.status(503).json({ error: "Policy database is unavailable." });
    const policy = await LegalPolicy.findOne({
      where: { DeletedAt: null, [sequelize.Sequelize.Op.or]: [{ PolicyId: Number(req.params.id) || null }, { PolicyKey: String(req.params.id) }] },
    });
    if (!policy) return res.status(404).json({ error: "Policy not found." });
    if (policy.Status === "archived") {
      return res.status(400).json({ error: "This policy is already archived." });
    }
    await sequelize.transaction(async (transaction) => {
      const activePolicyCount = await LegalPolicy.count({
        where: { DeletedAt: null, Status: { [sequelize.Sequelize.Op.ne]: "archived" } },
        transaction,
      });
      if (activePolicyCount <= 1) {
        throw new Error("At least one policy must remain active. The last policy cannot be archived.");
      }
      await LegalPolicyVersion.update(
        { Status: "archived", UpdatedAt: new Date() },
        { where: { PolicyId: policy.PolicyId }, transaction },
      );
      await policy.update({
        Status: "archived",
        PublishedAt: null,
        PublishedVersion: null,
        UpdatedAt: new Date(),
        UpdatedBy: req.user?.UserId || 1,
      }, { transaction });
    });
    await recordAuditLog(policy.PolicyId, "policy_archived", req, { key: policy.PolicyKey });
    return res.json({ policy: normalizePolicyData(await getPolicyByKeyOrId(String(policy.PolicyId))) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to archive policy." });
  }
});

router.post("/:id/versions", ensurePolicyAdmin, async (req, res) => {
  try {
    if (!sequelize || !LegalPolicy) return res.status(503).json({ error: "Policy database is unavailable." });
    const policy = await LegalPolicy.findOne({
      where: { DeletedAt: null, [sequelize.Sequelize.Op.or]: [{ PolicyId: Number(req.params.id) || null }, { PolicyKey: String(req.params.id) }] },
    });
    if (!policy) return res.status(404).json({ error: "Policy not found." });
    const created = await sequelize.transaction(async (transaction) => {
      const lockedPolicy = await LegalPolicy.findByPk(policy.PolicyId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!lockedPolicy || lockedPolicy.DeletedAt) throw new Error("Policy not found.");
      const existingDraft = await LegalPolicyVersion.findOne({
        where: { PolicyId: lockedPolicy.PolicyId, Status: "draft" },
        order: [["VersionNumber", "DESC"]],
        transaction,
      });
      if (existingDraft) return existingDraft;
      const versions = await LegalPolicyVersion.findAll({ where: { PolicyId: lockedPolicy.PolicyId }, transaction });
      const source = versions.find((version) => version.Status === "published")
        || versions.find((version) => Number(version.VersionNumber) === Number(lockedPolicy.PublishedVersion))
        || versions.sort((a, b) => Number(b.VersionNumber) - Number(a.VersionNumber))[0];
      if (!source) throw new Error("No policy content is available for a new version.");
      const draft = await LegalPolicyVersion.create({
        PolicyId: lockedPolicy.PolicyId,
        VersionNumber: nextDraftVersionNumber(versions),
        Title: source.Title,
        Slug: source.Slug,
        Category: source.Category,
        Description: source.Description,
        Content: source.Content,
        ContentJson: source.ContentJson,
        Status: "draft",
        CreatedBy: req.user?.UserId || 1,
        CreatedAt: new Date(),
        UpdatedAt: new Date(),
      }, { transaction });
      await lockedPolicy.update({ Version: Number(draft.VersionNumber), UpdatedAt: new Date(), UpdatedBy: req.user?.UserId || 1 }, { transaction });
      return draft;
    });
    await recordAuditLog(policy.PolicyId, "policy_version_created", req, { version: created.VersionNumber }, created.PolicyVersionId);
    return res.status(201).json({ policy: normalizePolicyData(await getPolicyByKeyOrId(String(policy.PolicyId))) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to create policy version." });
  }
});

router.get("/:id/history", ensurePolicyAdmin, async (req, res) => {
  try {
    const policy = await getPolicyByKeyOrId(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found." });
    return res.json({ versionHistory: policy.versions || [] });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load policy history." });
  }
});

router.delete("/:id/versions/:versionId", ensurePolicyAdmin, async (req, res) => {
  try {
    if (!sequelize || !LegalPolicy || !LegalPolicyVersion) {
      return res.status(503).json({ error: "Policy database is unavailable." });
    }
    const policy = await LegalPolicy.findOne({
      where: { DeletedAt: null, [sequelize.Sequelize.Op.or]: [{ PolicyId: Number(req.params.id) || null }, { PolicyKey: String(req.params.id) }] },
    });
    if (!policy) return res.status(404).json({ error: "Policy not found." });

    let removedVersion;
    await sequelize.transaction(async (transaction) => {
      const lockedPolicy = await LegalPolicy.findByPk(policy.PolicyId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!lockedPolicy || lockedPolicy.DeletedAt) throw new Error("Policy not found.");
      const version = await LegalPolicyVersion.findOne({
        where: { PolicyId: lockedPolicy.PolicyId, PolicyVersionId: Number(req.params.versionId) || null },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!version) throw new Error("Version not found.");
      removedVersion = { id: version.PolicyVersionId, version: Number(version.VersionNumber), status: version.Status };
      await LegalPolicyAuditLog.update(
        { PolicyVersionId: null },
        { where: { PolicyVersionId: version.PolicyVersionId }, transaction },
      );
      await version.destroy({ transaction });

      const remainingVersions = await LegalPolicyVersion.findAll({
        where: { PolicyId: lockedPolicy.PolicyId },
        order: [["VersionNumber", "DESC"]],
        transaction,
      });
      let published = remainingVersions.find((item) => item.Status === "published") || null;
      if (removedVersion.status === "published" && !published) {
        const previous = remainingVersions.find((item) => item.Status === "archived");
        if (previous) {
          await previous.update({ Status: "published", PublishedAt: new Date(), UpdatedAt: new Date() }, { transaction });
          published = previous;
        }
      }
      const fallback = published
        || remainingVersions.find((item) => item.Status === "draft")
        || remainingVersions[0]
        || null;
      if (fallback) {
        await lockedPolicy.update({
          Title: fallback.Title,
          Slug: fallback.Slug,
          Category: fallback.Category,
          Description: fallback.Description,
          Content: fallback.Content,
          ContentJson: fallback.ContentJson,
          Status: fallback.Status,
          Version: fallback.VersionNumber,
          PublishedAt: fallback.PublishedAt || null,
          PublishedVersion: fallback.Status === "published" ? fallback.VersionNumber : null,
          UpdatedAt: new Date(),
          UpdatedBy: req.user?.UserId || 1,
        }, { transaction });
      } else {
        await lockedPolicy.update({
          Status: "draft",
          PublishedAt: null,
          PublishedVersion: null,
          Version: removedVersion.version,
          UpdatedAt: new Date(),
          UpdatedBy: req.user?.UserId || 1,
        }, { transaction });
      }
    });

    await recordAuditLog(policy.PolicyId, "policy_version_deleted", req, removedVersion, null);
    return res.json({ policy: normalizePolicyData(await getPolicyByKeyOrId(String(policy.PolicyId))) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to delete policy version." });
  }
});

router.post("/:id/restore/:versionId", ensurePolicyAdmin, async (req, res) => {
  try {
    if (!sequelize || !LegalPolicy) return res.status(503).json({ error: "Policy database is unavailable." });
    const policy = await LegalPolicy.findOne({
      where: { DeletedAt: null, [sequelize.Sequelize.Op.or]: [{ PolicyId: Number(req.params.id) || null }, { PolicyKey: String(req.params.id) }] },
    });
    if (!policy) return res.status(404).json({ error: "Policy not found." });
    const restored = await sequelize.transaction(async (transaction) => {
      const lockedPolicy = await LegalPolicy.findByPk(policy.PolicyId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!lockedPolicy || lockedPolicy.DeletedAt) throw new Error("Policy not found.");
      const source = await LegalPolicyVersion.findOne({
        where: { PolicyId: lockedPolicy.PolicyId, PolicyVersionId: Number(req.params.versionId) || null },
        transaction,
      });
      if (!source) throw new Error("Version not found.");
      let draft = await LegalPolicyVersion.findOne({
        where: { PolicyId: lockedPolicy.PolicyId, Status: "draft" },
        order: [["VersionNumber", "DESC"]],
        transaction,
      });
      const now = new Date();
      if (draft) {
        await draft.update({
          Title: source.Title,
          Slug: source.Slug,
          Category: source.Category,
          Description: source.Description,
          Content: source.Content,
          ContentJson: source.ContentJson,
          UpdatedAt: now,
        }, { transaction });
      } else {
        const versions = await LegalPolicyVersion.findAll({ where: { PolicyId: lockedPolicy.PolicyId }, transaction });
        draft = await LegalPolicyVersion.create({
          PolicyId: lockedPolicy.PolicyId,
          VersionNumber: nextDraftVersionNumber(versions),
          Title: source.Title,
          Slug: source.Slug,
          Category: source.Category,
          Description: source.Description,
          Content: source.Content,
          ContentJson: source.ContentJson,
          Status: "draft",
          CreatedBy: req.user?.UserId || 1,
          CreatedAt: now,
          UpdatedAt: now,
        }, { transaction });
      }
      await lockedPolicy.update({ Version: Number(draft.VersionNumber), UpdatedAt: now, UpdatedBy: req.user?.UserId || 1 }, { transaction });
      return draft;
    });
    await recordAuditLog(policy.PolicyId, "policy_restored", req, { sourceVersionId: Number(req.params.versionId), restoredVersion: restored.VersionNumber }, restored.PolicyVersionId);
    return res.json({ policy: normalizePolicyData(await getPolicyByKeyOrId(String(policy.PolicyId))) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to restore version." });
  }
});

router.delete("/:id", ensurePolicyAdmin, async (req, res) => {
  try {
    if (!sequelize || !LegalPolicy || !LegalPolicyVersion || !LegalPolicyAuditLog) {
      return res.status(503).json({ error: "Policy database is unavailable." });
    }
    const policy = await LegalPolicy.findOne({
      where: { DeletedAt: null, [sequelize.Sequelize.Op.or]: [{ PolicyId: Number(req.params.id) || null }, { PolicyKey: String(req.params.id) }] },
    });
    if (!policy) return res.status(404).json({ error: "Policy not found." });

    await sequelize.transaction(async (transaction) => {
      const lockedPolicy = await LegalPolicy.findByPk(policy.PolicyId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!lockedPolicy || lockedPolicy.DeletedAt) throw new Error("Policy not found.");
      const versionCount = await LegalPolicyVersion.count({
        where: { PolicyId: lockedPolicy.PolicyId },
        transaction,
      });
      const now = new Date();
      await LegalPolicyAuditLog.create({
        PolicyId: lockedPolicy.PolicyId,
        PolicyVersionId: null,
        Action: "policy_deleted",
        ActorUserId: req.user?.UserId || null,
        ActorName: getActorName(req),
        Metadata: {
          policyKey: lockedPolicy.PolicyKey,
          title: lockedPolicy.Title,
          deletedVersionCount: versionCount,
        },
        CreatedAt: now,
      }, { transaction });
      await LegalPolicyVersion.destroy({
        where: { PolicyId: lockedPolicy.PolicyId },
        transaction,
      });
      await LegalPolicyAuditLog.update(
        { PolicyId: null, PolicyVersionId: null },
        { where: { PolicyId: lockedPolicy.PolicyId }, transaction },
      );
      await lockedPolicy.destroy({ transaction });
    });
    return res.status(204).send();
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to delete policy." });
  }
});

module.exports = router;
