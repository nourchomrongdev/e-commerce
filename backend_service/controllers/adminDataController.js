const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");

const resources = {
  products: {
    from: `FROM "Products" p
      JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
      JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
      LEFT JOIN "UserAccounts" ua ON ua."UserId" = cp."UserId"
      LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
      LEFT JOIN "Categories" c ON c."CategoryId" = p."CategoryId"`,
    select: `p."ProductId" AS id, p."ProductName" AS name, p."Slug" AS slug,
      cp."DisplayName" AS "creatorName", c."CategoryName" AS category,
      p."Price" AS price, p."Currency" AS currency, p."Status" AS status,
      p."ApprovalStatus" AS "approvalStatus",
      p."UpdatedAt" AS "updatedAt"`,
    search: [`p."ProductName"`, `p."Slug"`, `cp."DisplayName"`, `ui."Email"`, `s."StoreName"`, `c."CategoryName"`],
    searchJoins: "",
    searchableId: `p."ProductId"`,
    status: `p."Status"`,
    order: `p."UpdatedAt" DESC, p."ProductId" DESC`,
    count: `COUNT(DISTINCT p."ProductId")`,
  },
  creators: {
    from: `FROM "CreatorProfiles" cp
      JOIN "UserAccounts" ua ON ua."UserId" = cp."UserId"
      JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
      LEFT JOIN "UsersRoles" ur ON ur."UserRoleId" = ua."RoleId"`,
    select: `cp."CreatorProfileId" AS id, cp."DisplayName" AS name, ui."Email" AS email,
      ua."Status" AS status, cp."IsVerified" AS verified, cp."IsActive" AS active,
      cp."CreatedAt" AS "createdAt", ur."RoleName" AS role,
      (SELECT COUNT(*)::int FROM "Storefronts" s WHERE s."CreatorProfileId" = cp."CreatorProfileId") AS "storefrontCount"`,
    search: [`cp."DisplayName"`, `ui."Email"`],
    searchJoins: "",
    searchableId: `cp."CreatorProfileId"`,
    status: `ua."Status"`,
    order: `cp."CreatedAt" DESC, cp."CreatorProfileId" DESC`,
    count: `COUNT(DISTINCT cp."CreatorProfileId")`,
  },
  verification: {
    from: `FROM "CreatorProfiles" cp
      JOIN "UserAccounts" ua ON ua."UserId" = cp."UserId"
      JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"`,
    select: `cp."CreatorProfileId" AS id, cp."DisplayName" AS name, ui."Email" AS email,
      CASE WHEN cp."IsVerified" THEN 'verified' ELSE 'unverified' END AS status,
      ua."Status" AS "accountStatus", cp."CreatedAt" AS "createdAt"`,
    search: [`cp."DisplayName"`, `ui."Email"`],
    searchJoins: "",
    searchableId: `cp."CreatorProfileId"`,
    status: `CASE WHEN cp."IsVerified" THEN 'verified' ELSE 'unverified' END`,
    order: `cp."CreatedAt" DESC, cp."CreatorProfileId" DESC`,
    count: `COUNT(DISTINCT cp."CreatorProfileId")`,
  },
  storefronts: {
    from: `FROM "Storefronts" s
      JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
      LEFT JOIN "UserAccounts" ua ON ua."UserId" = cp."UserId"
      LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"`,
    select: `s."StorefrontId" AS id, s."StoreName" AS name, s."StoreSlug" AS slug,
      cp."DisplayName" AS "creatorName", ui."Email" AS "creatorEmail",
      s."IsPublished" AS published, s."IsActive" AS active, s."CreatedAt" AS "createdAt",
      (SELECT COUNT(*)::int FROM "Products" p WHERE p."StorefrontId" = s."StorefrontId") AS "productCount"`,
    search: [`s."StoreName"`, `s."StoreSlug"`, `cp."DisplayName"`, `ui."Email"`],
    searchJoins: "",
    searchableId: `s."StorefrontId"`,
    status: `CASE WHEN s."IsActive" AND s."IsPublished" THEN 'published' WHEN s."IsActive" THEN 'draft' ELSE 'inactive' END`,
    order: `s."CreatedAt" DESC, s."StorefrontId" DESC`,
    count: `COUNT(DISTINCT s."StorefrontId")`,
  },
  files: {
    from: `FROM "ProductFiles" pf
      JOIN "Products" p ON p."ProductId" = pf."ProductId"
      LEFT JOIN "ProductVersions" pv ON pv."ProductVersionId" = pf."ProductVersionId"`,
    select: `pf."ProductFileId" AS id, pf."FileName" AS name, p."ProductName" AS "productName",
      pv."VersionNumber" AS version, pf."FileSize" AS "fileSize", pf."MimeType" AS "mimeType",
      pf."IsActive" AS active, pf."CreatedAt" AS "createdAt"`,
    search: [`pf."FileName"`, `p."ProductName"`],
    searchJoins: "",
    searchableId: `pf."ProductFileId"`,
    status: `CASE WHEN pf."IsActive" THEN 'active' ELSE 'inactive' END`,
    order: `pf."CreatedAt" DESC, pf."ProductFileId" DESC`,
    count: `COUNT(DISTINCT pf."ProductFileId")`,
  },
  versions: {
    from: `FROM "ProductVersions" pv JOIN "Products" p ON p."ProductId" = pv."ProductId"`,
    select: `pv."ProductVersionId" AS id, p."ProductName" AS "productName",
      pv."VersionNumber" AS version, pv."ReleaseNotes" AS "releaseNotes",
      pv."IsCurrent" AS current, pv."CreatedAt" AS "createdAt"`,
    search: [`p."ProductName"`, `pv."VersionNumber"`],
    searchJoins: "",
    searchableId: `pv."ProductVersionId"`,
    status: `CASE WHEN pv."IsCurrent" THEN 'current' ELSE 'archived' END`,
    order: `pv."CreatedAt" DESC, pv."ProductVersionId" DESC`,
    count: `COUNT(DISTINCT pv."ProductVersionId")`,
  },
  "preview-assets": {
    from: `FROM "ProductPreviews" pp JOIN "Products" p ON p."ProductId" = pp."ProductId"
      LEFT JOIN "ProductVersions" pv ON pv."ProductVersionId" = pp."ProductVersionId"`,
    select: `pp."ProductPreviewId" AS id, COALESCE(pp."Title", pp."PreviewType") AS name,
      p."ProductName" AS "productName", pv."VersionNumber" AS version,
      pp."PreviewType" AS type, pp."IsActive" AS active, pp."CreatedAt" AS "createdAt"`,
    search: [`pp."Title"`, `pp."PreviewType"`, `p."ProductName"`],
    searchJoins: "",
    searchableId: `pp."ProductPreviewId"`,
    status: `CASE WHEN pp."IsActive" THEN 'active' ELSE 'inactive' END`,
    order: `pp."CreatedAt" DESC, pp."ProductPreviewId" DESC`,
    count: `COUNT(DISTINCT pp."ProductPreviewId")`,
  },
  downloads: {
    from: `FROM "Downloads" d
      JOIN "UserAccounts" ua ON ua."UserId" = d."UserId"
      JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
      JOIN "ProductFiles" pf ON pf."ProductFileId" = d."ProductFileId"
      JOIN "Products" p ON p."ProductId" = pf."ProductId"
      JOIN "OrderItems" oi ON oi."OrderItemId" = d."OrderItemId"
      JOIN "Orders" o ON o."OrderId" = oi."OrderId"`,
    select: `d."DownloadId" AS id, ui."FullName" AS "buyerName", ui."Email" AS "buyerEmail",
      p."ProductName" AS "productName", pf."FileName" AS "fileName",
      d."DownloadCount" AS "downloadCount", d."DownloadedAt" AS "downloadedAt",
      d."IPAddress" AS "ipAddress", d."UserAgent" AS "userAgent", o."OrderNumber" AS "orderNumber"`,
    search: [`ui."FullName"`, `ui."Email"`, `p."ProductName"`, `pf."FileName"`, `o."OrderNumber"`],
    searchJoins: "",
    searchableId: `d."DownloadId"`,
    status: `CASE WHEN d."DownloadedAt" IS NULL THEN 'issued' ELSE 'completed' END`,
    order: `COALESCE(d."DownloadedAt", d."CreatedAt") DESC, d."DownloadId" DESC`,
    count: `COUNT(DISTINCT d."DownloadId")`,
  },
  "download-links": {
    from: `FROM "Downloads" d
      JOIN "UserAccounts" ua ON ua."UserId" = d."UserId"
      JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
      JOIN "ProductFiles" pf ON pf."ProductFileId" = d."ProductFileId"
      JOIN "Products" p ON p."ProductId" = pf."ProductId"`,
    select: `d."DownloadId" AS id, ui."FullName" AS "buyerName", ui."Email" AS "buyerEmail",
      p."ProductName" AS "productName", pf."FileName" AS "fileName",
      d."ExpiresAt" AS "expiresAt", d."DownloadedAt" AS "downloadedAt",
      d."DownloadCount" AS "downloadCount",
      CASE WHEN d."ExpiresAt" IS NOT NULL AND d."ExpiresAt" <= CURRENT_TIMESTAMP THEN 'expired'
        WHEN d."DownloadedAt" IS NOT NULL THEN 'used' ELSE 'available' END AS status`,
    search: [`ui."FullName"`, `ui."Email"`, `p."ProductName"`, `pf."FileName"`],
    searchJoins: "",
    searchableId: `d."DownloadId"`,
    status: `CASE WHEN d."ExpiresAt" IS NOT NULL AND d."ExpiresAt" <= CURRENT_TIMESTAMP THEN 'expired'
      WHEN d."DownloadedAt" IS NOT NULL THEN 'used' ELSE 'available' END`,
    order: `d."CreatedAt" DESC, d."DownloadId" DESC`,
    count: `COUNT(DISTINCT d."DownloadId")`,
  },
  "content-rights": {
    from: `FROM "LicenseRules" lr LEFT JOIN "Storefronts" s ON s."StorefrontId" = lr."StorefrontId"`,
    select: `lr."LicenseRuleId" AS id, lr."RuleName" AS name, lr."AppliesTo" AS "appliesTo",
      lr."RuleType" AS type, lr."Description" AS description, lr."IsActive" AS active,
      s."StoreName" AS "storeName", lr."CreatedAt" AS "createdAt"`,
    search: [`lr."RuleName"`, `lr."AppliesTo"`, `lr."Description"`, `s."StoreName"`],
    searchJoins: "",
    searchableId: `lr."LicenseRuleId"`,
    status: `CASE WHEN lr."IsActive" THEN 'active' ELSE 'inactive' END`,
    order: `lr."CreatedAt" DESC, lr."LicenseRuleId" DESC`,
    count: `COUNT(DISTINCT lr."LicenseRuleId")`,
  },
  reviewers: {
    from: `FROM "UserAccounts" ua
      JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
      JOIN "UserAccountRoles" uar ON uar."UserId" = ua."UserId"
      JOIN "UsersRoles" ur ON ur."UserRoleId" = uar."UserRoleId"`,
    select: `ua."UserId" AS id, ui."FullName" AS name, ui."Email" AS email,
      ua."Status" AS status, ur."RoleName" AS role, ua."CreatedAt" AS "createdAt"`,
    search: [`ui."FullName"`, `ui."Email"`, `ur."RoleName"`],
    searchJoins: "",
    searchableId: `ua."UserId"`,
    status: `ua."Status"`,
    roleFilter: true,
    order: `ua."CreatedAt" DESC, ua."UserId" DESC`,
    count: `COUNT(DISTINCT ua."UserId")`,
  },
};

function parsePage(value, fallback = 1) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildWhere(config, req) {
  const predicates = [];
  const replacements = {};
  const search = String(req.query.search || "").trim();
  if (search) {
    const terms = config.search.map((field) => `${field} ILIKE :search`);
    terms.push(`CAST(${config.searchableId} AS text) = :exactId`);
    predicates.push(`(${terms.join(" OR ")})`);
    replacements.search = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    replacements.exactId = search;
  }
  const status = String(req.query.status || "").trim().toLowerCase();
  if (status) {
    predicates.push(`LOWER(CAST(${config.status} AS text)) = :status`);
    replacements.status = status;
  }
  if (config.roleFilter) predicates.push(`LOWER(ur."RoleName") IN ('content reviewer', 'reviewer')`);
  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  return { where, replacements };
}

async function listResource(req, res) {
  const resource = String(req.params.resource || "");
  const config = resources[resource];
  if (!Object.prototype.hasOwnProperty.call(resources, resource) || !config) {
    return res.status(501).json({ error: `No database-backed admin view is configured for '${resource}'.` });
  }
  const page = parsePage(req.query.page);
  const pageSize = Math.min(100, parsePage(req.query.pageSize, 10));
  const { where, replacements } = buildWhere(config, req);
  try {
    const [countRow] = await sequelize.query(
      `SELECT ${config.count} AS total, 0 AS marker ${config.from} ${where}`,
      { replacements, type: QueryTypes.SELECT },
    );
    const total = Number(countRow.total);
    const records = await sequelize.query(
      `SELECT ${config.select} ${config.from} ${where}
       ORDER BY ${config.order} LIMIT :limit OFFSET :offset`,
      {
        replacements: { ...replacements, limit: pageSize, offset: (page - 1) * pageSize },
        type: QueryTypes.SELECT,
      },
    );
    return res.json({
      resource,
      records,
      pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error) {
    console.error(`Admin ${resource} list failed`, error);
    return res.status(500).json({ error: `Unable to load ${resource.replaceAll("-", " ")}.` });
  }
}

function activityFilters(req) {
  const predicates = [];
  const replacements = {};
  const search = String(req.query.search || "").trim();
  const action = String(req.query.action || "").trim();
  const moduleName = String(req.query.module || "").trim();
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const outcome = String(req.query.outcome || "").trim().toLowerCase();
  if (search) {
    predicates.push(`(
      a."Action" ILIKE :search OR COALESCE(a."EntityType", '') ILIKE :search
      OR COALESCE(a."Description", '') ILIKE :search OR COALESCE(ui."FullName", '') ILIKE :search
      OR COALESCE(ui."Email", '') ILIKE :search OR CAST(a."ActivityLogId" AS text) = :exactId
    )`);
    replacements.search = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    replacements.exactId = search;
  }
  if (action) {
    predicates.push(`a."Action" = :action`);
    replacements.action = action.slice(0, 100);
  }
  if (moduleName) {
    predicates.push(`a."EntityType" = :module`);
    replacements.module = moduleName.slice(0, 100);
  }
  if (outcome) {
    if (!["success", "failure"].includes(outcome)) {
      throw new Error("The activity result filter is invalid.");
    }
    predicates.push(outcome === "success"
      ? `LOWER(COALESCE(a."Metadata"->>'outcome', '')) IN ('success', 'successful', 'completed')`
      : `LOWER(COALESCE(a."Metadata"->>'outcome', '')) IN ('failure', 'failed', 'error')`);
  }
  if (from) {
    if (!isValidDateFilter(from)) throw new Error("The activity start date is invalid.");
    predicates.push(`a."CreatedAt" >= CAST(:from AS date)`);
    replacements.from = from;
  }
  if (to) {
    if (!isValidDateFilter(to)) throw new Error("The activity end date is invalid.");
    predicates.push(`a."CreatedAt" < CAST(:to AS date) + INTERVAL '1 day'`);
    replacements.to = to;
  }
  return { where: predicates.length ? `WHERE ${predicates.join(" AND ")}` : "", replacements };
}

function isValidDateFilter(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const activityFrom = `FROM "ActivityLogs" a
  LEFT JOIN "UserAccounts" ua ON ua."UserId" = a."UserId"
  LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
  LEFT JOIN "UsersRoles" ur ON ur."UserRoleId" = ua."RoleId"`;
const activitySelect = `a."ActivityLogId" AS id, a."Action" AS action,
  a."EntityType" AS "entityType", a."EntityId" AS "entityId", a."Description" AS description,
  a."IPAddress" AS "ipAddress", a."UserAgent" AS "userAgent", a."Metadata" AS metadata,
  a."CreatedAt" AS "createdAt", a."UserId" AS "actorId",
  COALESCE(ui."FullName", 'Deleted account') AS "actorName", ui."Email" AS "actorEmail",
  ur."RoleName" AS "actorRole",
  a."Metadata"->>'outcome' AS outcome, a."Metadata"->>'deviceIdentifier' AS "deviceIdentifier"`;

async function listActivity(req, res) {
  const page = parsePage(req.query.page);
  const pageSize = Math.min(100, parsePage(req.query.pageSize, 20));
  const sortBy = String(req.query.sortBy || "createdAt");
  const sortOrder = String(req.query.sortOrder || "desc").toLowerCase();
  const sortColumns = {
    createdAt: `a."CreatedAt"`,
    action: `a."Action"`,
    entityType: `a."EntityType"`,
    entityId: `a."EntityId"`,
  };
  if (!Object.prototype.hasOwnProperty.call(sortColumns, sortBy) || !["asc", "desc"].includes(sortOrder)) {
    return res.status(400).json({ error: "The activity sort field or order is invalid." });
  }
  let filters;
  try {
    filters = activityFilters(req);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    const [countRow] = await sequelize.query(
      `SELECT COUNT(*) AS total, 0 AS marker ${activityFrom} ${filters.where}`,
      { replacements: filters.replacements, type: QueryTypes.SELECT },
    );
    const records = await sequelize.query(
      `SELECT ${activitySelect} ${activityFrom} ${filters.where}
       ORDER BY ${sortColumns[sortBy]} ${sortOrder.toUpperCase()} NULLS LAST, a."ActivityLogId" DESC
       LIMIT :limit OFFSET :offset`,
      {
        replacements: { ...filters.replacements, limit: pageSize, offset: (page - 1) * pageSize },
        type: QueryTypes.SELECT,
      },
    );
    return res.json({
      activities: records,
      pagination: { page, pageSize, total: Number(countRow.total), pages: Math.max(1, Math.ceil(Number(countRow.total) / pageSize)) },
    });
  } catch (error) {
    console.error("Admin activity list failed", error);
    return res.status(500).json({ error: "Unable to load activity records." });
  }
}

async function getActivity(req, res) {
  const id = parsePage(req.params.activityId, 0);
  if (!id) return res.status(400).json({ error: "A valid activity ID is required." });
  try {
    const [activity] = await sequelize.query(
      `SELECT ${activitySelect} ${activityFrom} WHERE a."ActivityLogId" = :id LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT },
    );
    if (!activity) return res.status(404).json({ error: "Activity record not found." });
    return res.json({ activity });
  } catch (error) {
    console.error("Admin activity detail failed", error);
    return res.status(500).json({ error: "Unable to load activity record." });
  }
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

async function exportActivity(req, res) {
  let filters;
  try {
    filters = activityFilters(req);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    const sortBy = String(req.query.sortBy || "createdAt");
    const sortOrder = String(req.query.sortOrder || "desc").toLowerCase();
    const sortColumns = {
      createdAt: `a."CreatedAt"`,
      action: `a."Action"`,
      entityType: `a."EntityType"`,
      entityId: `a."EntityId"`,
    };
    if (!Object.prototype.hasOwnProperty.call(sortColumns, sortBy) || !["asc", "desc"].includes(sortOrder)) {
      return res.status(400).json({ error: "The activity sort field or order is invalid." });
    }
    const records = await sequelize.query(
      `SELECT ${activitySelect} ${activityFrom} ${filters.where}
       ORDER BY ${sortColumns[sortBy]} ${sortOrder.toUpperCase()} NULLS LAST, a."ActivityLogId" DESC LIMIT 10000`,
      { replacements: filters.replacements, type: QueryTypes.SELECT },
    );
    const fields = ["id", "createdAt", "actorId", "actorName", "actorEmail", "actorRole", "action", "entityType", "entityId", "description", "ipAddress", "userAgent", "outcome", "deviceIdentifier", "metadata"];
    const csv = [fields.map(csvCell).join(","), ...records.map((record) => fields.map((field) => csvCell(record[field])).join(","))].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="admin-activity.csv"');
    return res.send(`\uFEFF${csv}`);
  } catch (error) {
    console.error("Admin activity export failed", error);
    return res.status(500).json({ error: "Unable to export activity records." });
  }
}

async function getDashboard(req, res) {
  const period = String(req.query.period || "month").toLowerCase();
  if (!["month", "year"].includes(period)) {
    return res.status(400).json({ error: "Period must be 'month' or 'year'." });
  }
  try {
    const [summary] = await sequelize.query(
      `SELECT
        (SELECT COUNT(*)::int FROM "Orders") AS "totalOrders",
        (SELECT COUNT(*)::int FROM "UserAccounts") AS "totalUsers",
        (SELECT COUNT(*)::int FROM "Products") AS "totalProducts",
        (SELECT COUNT(*)::int FROM "CreatorProfiles" WHERE "IsActive" = TRUE) AS "activeCreators",
        (SELECT COUNT(*)::int FROM "UserAccounts" WHERE "CreatedAt" >= date_trunc('month', CURRENT_TIMESTAMP)) AS "newUsersThisMonth"`,
      { type: QueryTypes.SELECT },
    );
    const revenueByCurrency = await sequelize.query(
      `SELECT pay."Currency" AS currency, COUNT(*)::int AS payments,
        SUM(pay."Amount")::numeric(18,2) AS revenue
       FROM "Payments" pay
       WHERE pay."PaidAt" IS NOT NULL AND pay."Status" IN ('paid', 'partially_refunded', 'refunded')
       GROUP BY pay."Currency" ORDER BY pay."Currency"`,
      { type: QueryTypes.SELECT },
    );
    const chart = await sequelize.query(
      `SELECT date_trunc(:bucket, pay."PaidAt") AS period,
        pay."Currency" AS currency, SUM(pay."Amount")::numeric(18,2) AS revenue
       FROM "Payments" pay
       WHERE pay."PaidAt" IS NOT NULL AND pay."Status" IN ('paid', 'partially_refunded', 'refunded')
         AND pay."PaidAt" >= CASE WHEN :period = 'year' THEN date_trunc('year', CURRENT_TIMESTAMP)
           ELSE date_trunc('month', CURRENT_TIMESTAMP) END
       GROUP BY date_trunc(:bucket, pay."PaidAt"), pay."Currency"
       ORDER BY period, currency`,
      {
        replacements: { period, bucket: period === "year" ? "month" : "day" },
        type: QueryTypes.SELECT,
      },
    );
    const categories = await sequelize.query(
      `SELECT c."CategoryName" AS category, p."Currency" AS currency,
        SUM(oi."TotalAmount")::numeric(18,2) AS revenue
       FROM "OrderItems" oi
       JOIN "Orders" o ON o."OrderId" = oi."OrderId"
       JOIN "Products" p ON p."ProductId" = oi."ProductId"
       LEFT JOIN "Categories" c ON c."CategoryId" = p."CategoryId"
       WHERE EXISTS (
         SELECT 1 FROM "Payments" pay WHERE pay."OrderId" = o."OrderId"
           AND pay."PaidAt" IS NOT NULL AND pay."Status" IN ('paid', 'partially_refunded', 'refunded')
       )
       GROUP BY c."CategoryName", p."Currency" ORDER BY revenue DESC NULLS LAST LIMIT 8`,
      { type: QueryTypes.SELECT },
    );
    const recentOrders = await sequelize.query(
      `SELECT o."OrderId" AS id, o."OrderNumber" AS "orderNumber",
        ui."FullName" AS "buyerName", o."TotalAmount" AS "totalAmount",
        o."Currency" AS currency, o."Status" AS status, o."CreatedAt" AS "createdAt"
       FROM "Orders" o JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
       JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
       ORDER BY o."CreatedAt" DESC, o."OrderId" DESC LIMIT 5`,
      { type: QueryTypes.SELECT },
    );
    const recentActivity = await sequelize.query(
      `SELECT ${activitySelect} ${activityFrom}
       ORDER BY a."CreatedAt" DESC, a."ActivityLogId" DESC LIMIT 5`,
      { type: QueryTypes.SELECT },
    );
    return res.json({ summary, revenueByCurrency, chart, categories, recentOrders, recentActivity, period });
  } catch (error) {
    console.error("Admin dashboard query failed", error);
    return res.status(500).json({ error: "Unable to load marketplace dashboard data." });
  }
}

module.exports = { exportActivity, getActivity, getDashboard, listActivity, listResource };
