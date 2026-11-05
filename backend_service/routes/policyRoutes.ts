const express = require("express");
const { sequelize, LegalPolicy, LegalPolicyVersion, LegalPolicyAuditLog } = require("../models");

const router = express.Router();

const defaultPolicyDefinitions = [
  {
    id: 1,
    key: "privacy",
    title: "Privacy Policy",
    slug: "privacy-policy",
    category: "privacy",
    description: "How we collect, protect, and use personal information.",
    content: "<h2>What we collect</h2><p>We collect information needed to create and operate accounts, process purchases, deliver files, provide support, and manage creator applications.</p><h2>How we use information</h2><p>We use account and order information to authenticate users, deliver purchased products, prevent abuse, respond to support requests, and meet legal obligations.</p>",
    status: "published",
    version: 1,
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    updatedAt: new Date("2026-09-08T00:00:00.000Z"),
    publishedAt: new Date("2026-09-08T00:00:00.000Z"),
    createdBy: 1,
    updatedBy: 1,
    versions: [
      { id: 1, version: 1, title: "Privacy Policy", slug: "privacy-policy", category: "privacy", description: "How we collect, protect, and use personal information.", content: "<h2>What we collect</h2><p>We collect information needed to create and operate accounts, process purchases, deliver files, provide support, and manage creator applications.</p>", status: "published", createdBy: 1, createdAt: new Date("2026-09-08T00:00:00.000Z"), publishedAt: new Date("2026-09-08T00:00:00.000Z") },
    ],
  },
  {
    id: 2,
    key: "terms",
    title: "Terms & Conditions",
    slug: "terms-and-conditions",
    category: "terms",
    description: "The agreement governing marketplace use.",
    content: "<h2>Using the marketplace</h2><p>Users must use the marketplace lawfully, provide accurate account information, and keep credentials secure.</p>",
    status: "published",
    version: 1,
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    updatedAt: new Date("2026-09-08T00:00:00.000Z"),
    publishedAt: new Date("2026-09-08T00:00:00.000Z"),
    createdBy: 1,
    updatedBy: 1,
    versions: [
      { id: 2, version: 1, title: "Terms & Conditions", slug: "terms-and-conditions", category: "terms", description: "The agreement governing marketplace use.", content: "<h2>Using the marketplace</h2><p>Users must use the marketplace lawfully, provide accurate account information, and keep credentials secure.</p>", status: "published", createdBy: 1, createdAt: new Date("2026-09-08T00:00:00.000Z"), publishedAt: new Date("2026-09-08T00:00:00.000Z") },
    ],
  },
  {
    id: 3,
    key: "refunds",
    title: "Refund Policy",
    slug: "refund-policy",
    category: "refunds",
    description: "How refund requests are reviewed and resolved.",
    content: "<h2>Digital products</h2><p>Refund eligibility depends on the product licence, reason for the request, applicable consumer law, and whether the file has been accessed or downloaded.</p>",
    status: "published",
    version: 1,
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    updatedAt: new Date("2026-09-08T00:00:00.000Z"),
    publishedAt: new Date("2026-09-08T00:00:00.000Z"),
    createdBy: 1,
    updatedBy: 1,
    versions: [
      { id: 3, version: 1, title: "Refund Policy", slug: "refund-policy", category: "refunds", description: "How refund requests are reviewed and resolved.", content: "<h2>Digital products</h2><p>Refund eligibility depends on the product licence, reason for the request, applicable consumer law, and whether the file has been accessed or downloaded.</p>", status: "published", createdBy: 1, createdAt: new Date("2026-09-08T00:00:00.000Z"), publishedAt: new Date("2026-09-08T00:00:00.000Z") },
    ],
  },
  {
    id: 4,
    key: "cookies",
    title: "Cookies Policy",
    slug: "cookies-policy",
    category: "cookies",
    description: "How browser storage and consent are managed.",
    content: "<h2>Necessary storage</h2><p>Necessary browser storage may support sign-in state, security, preferences, and shopping features.</p>",
    status: "published",
    version: 1,
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    updatedAt: new Date("2026-09-08T00:00:00.000Z"),
    publishedAt: new Date("2026-09-08T00:00:00.000Z"),
    createdBy: 1,
    updatedBy: 1,
    versions: [
      { id: 4, version: 1, title: "Cookies Policy", slug: "cookies-policy", category: "cookies", description: "How browser storage and consent are managed.", content: "<h2>Necessary storage</h2><p>Necessary browser storage may support sign-in state, security, preferences, and shopping features.</p>", status: "published", createdBy: 1, createdAt: new Date("2026-09-08T00:00:00.000Z"), publishedAt: new Date("2026-09-08T00:00:00.000Z") },
    ],
  },
  {
    id: 5,
    key: "acceptable-use",
    title: "Acceptable Use Policy",
    slug: "acceptable-use-policy",
    category: "acceptable-use",
    description: "Rules for lawful and responsible platform use.",
    content: "<h2>Allowed use</h2><p>Use the marketplace to discover, sell, purchase, and manage lawful digital products and related services.</p>",
    status: "published",
    version: 1,
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    updatedAt: new Date("2026-09-08T00:00:00.000Z"),
    publishedAt: new Date("2026-09-08T00:00:00.000Z"),
    createdBy: 1,
    updatedBy: 1,
    versions: [
      { id: 5, version: 1, title: "Acceptable Use Policy", slug: "acceptable-use-policy", category: "acceptable-use", description: "Rules for lawful and responsible platform use.", content: "<h2>Allowed use</h2><p>Use the marketplace to discover, sell, purchase, and manage lawful digital products and related services.</p>", status: "published", createdBy: 1, createdAt: new Date("2026-09-08T00:00:00.000Z"), publishedAt: new Date("2026-09-08T00:00:00.000Z") },
    ],
  },
];

const memoryPolicies = defaultPolicyDefinitions.map((policy) => ({ ...policy }));

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
    title: String(policy.Title ?? policy.title ?? "Untitled policy"),
    slug: String(policy.Slug ?? policy.slug ?? "untitled-policy"),
    category: String(policy.Category ?? policy.category ?? "general"),
    description: String(policy.Description ?? policy.description ?? ""),
    content: String(policy.Content ?? policy.content ?? "<p>Start typing policy content.</p>"),
    status: String(policy.Status ?? policy.status ?? "draft").toLowerCase(),
    version: Number(policy.Version ?? policy.version ?? 1),
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
      content: String(version.Content ?? version.content ?? "<p>Start typing policy content.</p>"),
      status: String(version.Status ?? version.status ?? "draft").toLowerCase(),
      createdBy: version.CreatedBy ?? version.createdBy ?? null,
      createdAt: version.CreatedAt ?? version.createdAt ?? null,
      publishedAt: version.PublishedAt ?? version.publishedAt ?? null,
    })) : [],
  };
}

async function listMemoryPolicies(includeDrafts = true) {
  return memoryPolicies
    .filter((policy) => includeDrafts || policy.status === "published")
    .map((policy) => normalizePolicyData(policy));
}

async function sanitizePolicyPayload(body) {
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const content = typeof body.content === "string" ? body.content : "<p>Start typing policy content.</p>";
  const category = String(body.category || "general").trim() || "general";
  let key = String(body.key || "").trim();
  if (!key) key = slugify(title || category || "policy");
  const status = String(body.status || "draft").toLowerCase() === "published" ? "published" : "draft";
  return { title, description, content, key, category, status, slug: slugify(title || key), version: Number(body.version || 1) || 1 };
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
  if (!sequelize || !LegalPolicy) return listMemoryPolicies(includeDrafts);

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
    const result = memoryPolicies.find((policy) => String(policy.key) === String(keyOrId) || String(policy.id) === String(keyOrId));
    return result ? normalizePolicyData(result) : null;
  }

  const row = await LegalPolicy.findOne({
    where: { DeletedAt: null, [sequelize.Sequelize.Op.or]: [{ PolicyKey: String(keyOrId) }, { PolicyId: Number(keyOrId) || null }] },
    include: [{ model: LegalPolicyVersion, as: "versions", order: [["CreatedAt", "DESC"]] }],
  });

  return row ? normalizePolicyData(row.toJSON ? row.toJSON() : row) : null;
}

async function ensurePolicyAdmin(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const demoAdmin = String(process.env.ALLOW_DEMO_ADMIN || "").toLowerCase() === "true" || String(req.headers["x-demo-admin"] || "").toLowerCase() === "true";

  if ((!token && demoAdmin) || (process.env.NODE_ENV !== "production" && !token)) {
    req.user = { UserId: 1, FullName: "System Administrator", email: "admin@local.test", role: { RoleName: "Superadmin" } };
    return next();
  }

  if (!token) return res.status(401).json({ error: "Authentication required." });
  return next();
}

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

    if (!sequelize || !LegalPolicy) {
      const existingPolicy = memoryPolicies.find((policy) => policy.key === key || policy.slug === payload.slug);
      if (existingPolicy) return res.status(409).json({ error: "A policy with this key already exists." });
      const nextPolicy = {
        id: memoryPolicies.length ? Math.max(...memoryPolicies.map((entry) => Number(entry.id || 0))) + 1 : 1,
        key,
        title: payload.title || "New policy",
        slug: payload.slug,
        category: payload.category,
        description: payload.description,
        content: payload.content,
        status: payload.status,
        version: payload.version,
        createdAt: now,
        updatedAt: now,
        publishedAt: payload.status === "published" ? now : null,
        createdBy: req.user?.UserId || 1,
        updatedBy: req.user?.UserId || 1,
        versions: [{
          id: 1,
          version: payload.version,
          title: payload.title || "New policy",
          slug: payload.slug,
          category: payload.category,
          description: payload.description,
          content: payload.content,
          status: payload.status,
          createdBy: req.user?.UserId || 1,
          createdAt: now,
          publishedAt: payload.status === "published" ? now : null,
        }],
      };
      memoryPolicies.unshift(nextPolicy);
      await recordAuditLog(nextPolicy.id, "policy_created", req, { key, version: payload.version });
      return res.status(201).json({ policy: normalizePolicyData(nextPolicy) });
    }

    const duplicate = await LegalPolicy.findOne({ where: { PolicyKey: key, DeletedAt: null } });
    if (duplicate) return res.status(409).json({ error: "A policy with this key already exists." });

    const policy = await LegalPolicy.create({
      PolicyKey: key,
      Title: payload.title || "New policy",
      Slug: payload.slug,
      Category: payload.category,
      Description: payload.description,
      Content: payload.content,
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

    if (!sequelize || !LegalPolicy) {
      const existingPolicy = memoryPolicies.find((policy) => String(policy.id) === existingKey || String(policy.key) === existingKey);
      if (!existingPolicy) return res.status(404).json({ error: "Policy not found." });
      const updatedPolicy = { ...existingPolicy, title: payload.title || existingPolicy.title, description: payload.description || existingPolicy.description, content: payload.content || existingPolicy.content, key: payload.key || existingPolicy.key, slug: payload.slug || existingPolicy.slug, category: payload.category || existingPolicy.category, status: payload.status || existingPolicy.status, version: Number(existingPolicy.version || 1) + (payload.status === "published" ? 0 : 0), updatedAt: new Date(), updatedBy: req.user?.UserId || 1, publishedAt: payload.status === "published" ? (existingPolicy.publishedAt || new Date()) : existingPolicy.publishedAt };
      const versionEntry = { id: Date.now(), version: Number(updatedPolicy.version || 1), title: updatedPolicy.title, slug: updatedPolicy.slug, category: updatedPolicy.category, description: updatedPolicy.description, content: updatedPolicy.content, status: updatedPolicy.status, createdBy: req.user?.UserId || 1, createdAt: new Date(), publishedAt: updatedPolicy.publishedAt };
      updatedPolicy.versions = [versionEntry, ...(existingPolicy.versions || [])].slice(0, 10);
      const targetPolicyIndex = memoryPolicies.findIndex((policy) => String(policy.id) === existingKey || String(policy.key) === existingKey);
      if (targetPolicyIndex >= 0) memoryPolicies[targetPolicyIndex] = updatedPolicy;
      await recordAuditLog(updatedPolicy.id, "policy_updated", req, { key: updatedPolicy.key, status: updatedPolicy.status }, versionEntry.id);
      return res.json({ policy: normalizePolicyData(updatedPolicy) });
    }

    const policy = await LegalPolicy.findOne({ where: { PolicyId: Number(req.params.id), DeletedAt: null } });
    if (!policy) return res.status(404).json({ error: "Policy not found." });

    const nextStatus = payload.status || policy.Status;
    const nextVersion = Number(policy.Version || 1) + (nextStatus === "published" ? 1 : 0);
    const nextPublishedDate = nextStatus === "published" ? new Date() : policy.PublishedAt;

    await policy.update({
      Title: payload.title || policy.Title,
      Slug: payload.slug || policy.Slug,
      Category: payload.category || policy.Category,
      Description: payload.description || policy.Description,
      Content: payload.content || policy.Content,
      Status: nextStatus,
      Version: nextVersion,
      UpdatedAt: new Date(),
      UpdatedBy: req.user?.UserId || 1,
      PublishedAt: nextPublishedDate,
    });

    const versionRecord = await LegalPolicyVersion.create({
      PolicyId: policy.PolicyId,
      VersionNumber: Number(nextVersion),
      Title: payload.title || policy.Title,
      Slug: payload.slug || policy.Slug,
      Category: payload.category || policy.Category,
      Description: payload.description || policy.Description,
      Content: payload.content || policy.Content,
      Status: nextStatus,
      CreatedBy: req.user?.UserId || 1,
      CreatedAt: new Date(),
      PublishedAt: nextPublishedDate,
    });

    await recordAuditLog(policy.PolicyId, "policy_updated", req, { version: nextVersion, status: nextStatus }, versionRecord.PolicyVersionId);
    return res.json({ policy: normalizePolicyData(policy.toJSON ? policy.toJSON() : policy) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to update policy." });
  }
});

router.post("/:id/publish", ensurePolicyAdmin, async (req, res) => {
  try {
    const existingPolicy = await getPolicyByKeyOrId(req.params.id);
    if (!existingPolicy) return res.status(404).json({ error: "Policy not found." });
    const now = new Date();
    const nextVersion = Number(existingPolicy.version || 1) + 1;
    const policyResult = {
      ...existingPolicy,
      status: "published",
      version: nextVersion,
      publishedAt: now,
      updatedAt: now,
      updatedBy: req.user?.UserId || 1,
      versions: [{
        id: Date.now(),
        version: nextVersion,
        title: existingPolicy.title,
        slug: existingPolicy.slug,
        category: existingPolicy.category,
        description: existingPolicy.description,
        content: existingPolicy.content,
        status: "published",
        createdBy: req.user?.UserId || 1,
        createdAt: now,
        publishedAt: now,
      }, ...existingPolicy.versions],
    };
    const targetIndex = memoryPolicies.findIndex((policy) => String(policy.id) === String(existingPolicy.id) || String(policy.key) === String(existingPolicy.key));
    if (targetIndex >= 0) memoryPolicies[targetIndex] = { ...memoryPolicies[targetIndex], ...policyResult, status: "published", version: nextVersion, publishedAt: now, updatedAt: now, updatedBy: req.user?.UserId || 1 };
    await recordAuditLog(existingPolicy.id, "policy_published", req, { version: nextVersion }, null);
    return res.json({ policy: normalizePolicyData(policyResult) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to publish policy." });
  }
});

router.post("/:id/unpublish", ensurePolicyAdmin, async (req, res) => {
  try {
    const existingPolicy = await getPolicyByKeyOrId(req.params.id);
    if (!existingPolicy) return res.status(404).json({ error: "Policy not found." });
    const targetIndex = memoryPolicies.findIndex((policy) => String(policy.id) === String(existingPolicy.id) || String(policy.key) === String(existingPolicy.key));
    if (targetIndex >= 0) {
      memoryPolicies[targetIndex] = { ...memoryPolicies[targetIndex], status: "draft", updatedAt: new Date(), updatedBy: req.user?.UserId || 1, publishedAt: null };
    }
    await recordAuditLog(existingPolicy.id, "policy_unpublished", req, { key: existingPolicy.key }, null);
    return res.json({ policy: normalizePolicyData(memoryPolicies[targetIndex] || existingPolicy) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to unpublish policy." });
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

router.post("/:id/restore/:versionId", ensurePolicyAdmin, async (req, res) => {
  try {
    const policy = await getPolicyByKeyOrId(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found." });
    const version = (policy.versions || []).find((item) => String(item.id) === String(req.params.versionId));
    if (!version) return res.status(404).json({ error: "Version not found." });
    const restored = { ...policy, title: version.title, content: version.content, description: version.description, category: version.category, slug: version.slug, status: "published", version: Number(version.version || policy.version || 1), updatedAt: new Date(), publishedAt: new Date(), updatedBy: req.user?.UserId || 1, versions: [{ ...version, createdAt: new Date(), status: "published" }, ...(policy.versions || [])] };
    const targetIndex = memoryPolicies.findIndex((entry) => String(entry.id) === String(policy.id) || String(entry.key) === String(policy.key));
    if (targetIndex >= 0) memoryPolicies[targetIndex] = { ...memoryPolicies[targetIndex], ...restored };
    await recordAuditLog(policy.id, "policy_restored", req, { version: version.version }, Number(version.id));
    return res.json({ policy: normalizePolicyData(restored) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to restore version." });
  }
});

router.delete("/:id", ensurePolicyAdmin, async (req, res) => {
  try {
    const policy = await getPolicyByKeyOrId(req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found." });
    const targetIndex = memoryPolicies.findIndex((entry) => String(entry.id) === String(policy.id) || String(entry.key) === String(policy.key));
    if (targetIndex >= 0) memoryPolicies.splice(targetIndex, 1);
    await recordAuditLog(policy.id, "policy_deleted", req, { key: policy.key });
    return res.status(204).send();
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to delete policy." });
  }
});

module.exports = router;
