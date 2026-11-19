const express = require("express");
const crypto = require("crypto");
const { QueryTypes } = require("sequelize");
const { sequelize, Product, Storefront, CreatorProfile, ProductVersion, ProductFile, ProductPreview } = require("../models");
const { readProductFile } = require("../services/productFileService");
const { createNotification, notifyRoles } = require("../services/notificationService");

const MARKETPLACE_FEE_RATE = 0.2;

function serializeProduct(product) {
  return {
    id: product.ProductId,
    uuid: product.UUID,
    name: String(product.ProductName || "").charAt(0).toUpperCase() + String(product.ProductName || "").slice(1),
    slug: product.Slug,
    shortDescription: product.ShortDescription || "",
    description: product.Description || "",
    productType: product.ProductType,
    price: Number(product.Price || 0),
    discount: Number(product.DiscountPercent || 0),
    discountType: product.DiscountType || "none",
    discountAmount: Number(product.DiscountAmount || 0),
    currency: product.Currency || "USD",
    status: String(product.Status || "draft").toLowerCase(),
    approvalStatus: String(product.ApprovalStatus || "draft").toLowerCase(),
    publishAfterApproval: Boolean(product.PublishAfterApproval),
    storefrontId: product.StorefrontId,
    createdAt: product.CreatedAt,
    updatedAt: product.UpdatedAt,
  };
}

function parseDiscount(body: any, price: number, fallback: { type?: string; amount?: number } = {}) {
  const discountType = String(body.discountType || fallback.type || "none").toLowerCase();
  const requestedAmount = Number(body.discountAmount ?? body.discount ?? fallback.amount ?? 0);
  if (!["none", "percentage", "fixed"].includes(discountType) || !Number.isFinite(requestedAmount) || requestedAmount < 0) {
    throw new Error("Discount must be a valid percentage or fixed amount.");
  }
  if (discountType === "percentage" && requestedAmount > 100) throw new Error("Percentage discount must be between 0 and 100.");
  if (discountType === "fixed" && requestedAmount + price * MARKETPLACE_FEE_RATE >= price) {
    throw new Error("Fixed discount plus the 20% marketplace fee must be less than the product price.");
  }
  return {
    type: discountType,
    amount: discountType === "none" ? 0 : requestedAmount,
    percent: discountType === "fixed" && price > 0 ? (requestedAmount / price) * 100 : discountType === "percentage" ? requestedAmount : 0,
  };
}

async function resolveCategoryId(categoryName) {
  const name = String(categoryName || "Uncategorized").trim() || "Uncategorized";
  const [existing] = await sequelize.query(
    'SELECT "CategoryId" FROM "Categories" WHERE lower("CategoryName") = lower(:name) AND "ParentCategoryId" IS NULL LIMIT 1',
    { replacements: { name } },
  );
  if (existing[0]?.CategoryId) return Number(existing[0].CategoryId);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "uncategorized";
  await sequelize.query(
    'INSERT INTO "Categories" ("CategoryName", "Slug", "ParentCategoryId", "Description") VALUES (:name, :slug, NULL, :description) ON CONFLICT ("Slug") DO NOTHING',
    { replacements: { name, slug, description: `${name} products` } },
  );
  const [created] = await sequelize.query('SELECT "CategoryId" FROM "Categories" WHERE "Slug" = :slug LIMIT 1', { replacements: { slug } });
  return Number(created[0]?.CategoryId || 0);
}

async function uniqueProductSlug(requestedSlug) {
  const baseSlug = String(requestedSlug || "product").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/(^-|-$)/g, "") || "product";
  let candidate = baseSlug;
  let suffix = 2;
  while (await Product.count({ where: { Slug: candidate } })) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function assertTextLimit(label, value, maximum) {
  if (String(value || "").length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
}

function assertWordLimit(label, value, maximum) {
  const text = String(value || "");
  const words = text.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) || [];
  if (words.length > maximum || text.length > 500) throw new Error(`${label} must be ${maximum} words or fewer and no more than 500 characters.`);
}

module.exports = function createProductRoutes({ requireAdmin }) {
  const router = express.Router();

  router.get("/products", async (req, res) => {
    try {
      const databaseProducts = await Product.findAll({
        where: { Status: "published", ApprovalStatus: "approved" },
        include: [{
          model: Storefront,
          as: "storefront",
          required: true,
          where: { IsPublished: true, IsActive: true },
          include: [{
            model: CreatorProfile,
            as: "creatorProfile",
            required: true,
            where: { IsActive: true },
          }],
        }],
        order: [["CreatedAt", "DESC"]],
      });
      return res.json({ products: databaseProducts.map(serializeProduct) });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Unable to load products." });
    }
  });

  router.get("/admin/products", requireAdmin, async (req, res) => {
    try {
      const databaseProducts = await Product.findAll({ order: [["CreatedAt", "DESC"]] });
      return res.json({ products: databaseProducts.map(serializeProduct) });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Unable to load products." });
    }
  });

  router.get("/admin/product-approvals", requireAdmin, async (req, res) => {
    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || "10"), 10) || 10));
    const status = String(req.query.status || "pending").trim().toLowerCase();
    const search = String(req.query.search || "").trim().slice(0, 200);
    const validStatuses = ["draft", "pending", "changes_requested", "approved", "rejected"];
    if (status && status !== "all" && !validStatuses.includes(status)) return res.status(400).json({ error: "Invalid product approval status filter." });
    const conditions = [];
    const replacements: Record<string, unknown> = { limit: pageSize, offset: (page - 1) * pageSize };
    if (status && status !== "all") {
      conditions.push('p."ApprovalStatus" = :status');
      replacements.status = status;
    }
    if (search) {
      conditions.push('(p."ProductName" ILIKE :search OR s."StoreName" ILIKE :search OR cp."DisplayName" ILIKE :search)');
      replacements.search = `%${search}%`;
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    try {
      const [countRows, products] = await Promise.all([
        sequelize.query(
          `SELECT COUNT(*)::int AS total
           FROM "Products" p JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
           JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId" ${where}`,
          { replacements },
        ),
        sequelize.query(
          `SELECT p."ProductId" AS id, p."ProductName" AS name, p."Slug" AS slug,
                  p."ShortDescription" AS "shortDescription", p."Description" AS description,
                  p."ProductType" AS "productType", p."Price" AS price, p."Currency" AS currency,
                  p."Status" AS status, p."ApprovalStatus" AS "approvalStatus",
                  p."CreatedAt" AS "createdAt", p."UpdatedAt" AS "updatedAt",
                  s."StoreName" AS "storeName", cp."DisplayName" AS "creatorName",
                  c."CategoryName" AS "categoryName"
           FROM "Products" p JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
           JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
           LEFT JOIN "Categories" c ON c."CategoryId" = p."CategoryId"
           ${where}
           ORDER BY p."UpdatedAt" DESC, p."ProductId" DESC
           LIMIT :limit OFFSET :offset`,
          { replacements },
        ),
      ]);
      const total = Number(countRows[0][0]?.total || 0);
      return res.json({
        products: products[0],
        pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      });
    } catch (error) {
      console.error("Product approval queue load failed", error);
      return res.status(500).json({ error: "Unable to load product approval queue." });
    }
  });

  router.get("/admin/products/:productId", requireAdmin, async (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: "A valid product ID is required." });
    try {
      const product = await Product.findByPk(productId);
      if (!product) return res.status(404).json({ error: "Product not found." });
      const [storefront, versions, files, previews, events] = await Promise.all([
        Storefront.findByPk(product.StorefrontId, { include: [{ model: CreatorProfile, as: "creatorProfile" }] }),
        ProductVersion.findAll({ where: { ProductId: productId }, order: [["CreatedAt", "DESC"]] }),
        ProductFile.findAll({ where: { ProductId: productId, IsActive: true }, order: [["CreatedAt", "ASC"]] }),
        ProductPreview.findAll({ where: { ProductId: productId, IsActive: true }, order: [["SortOrder", "ASC"]] }),
        sequelize.query(
          `SELECT e."PreviousStatus" AS "previousStatus", e."NewStatus" AS "newStatus",
                  e."Reason" AS reason, e."InternalNote" AS "internalNote", e."CreatedAt" AS "createdAt",
                  ui."FullName" AS "actorName"
           FROM "ProductApprovalEvents" e
           LEFT JOIN "UserAccounts" ua ON ua."UserId" = e."ActorUserId"
           LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
           WHERE e."ProductId" = :productId ORDER BY e."CreatedAt" DESC`,
          { replacements: { productId } },
        ),
      ]);
      return res.json({
        product: {
          ...serializeProduct(product),
          shortDescription: product.ShortDescription || "",
          description: product.Description || "",
          creatorName: storefront?.creatorProfile?.DisplayName || "",
          storeName: storefront?.StoreName || "",
          versions: versions.map((version) => ({
            id: version.ProductVersionId,
            version: version.VersionNumber,
            price: Number(version.Price || 0),
            releaseNotes: version.ReleaseNotes || "",
            current: Boolean(version.IsCurrent),
          })),
          files: files.map((file) => ({
            id: file.UUID,
            name: file.FileName,
            size: Number(file.FileSize || 0),
            mimeType: file.MimeType || "application/octet-stream",
          })),
          previews: previews.map((preview) => ({
            id: preview.ProductPreviewId,
            title: preview.Title || "",
            type: preview.PreviewType,
            url: preview.PreviewUrl,
          })),
          history: events[0],
        },
      });
    } catch (error) {
      console.error("Product review detail load failed", error);
      return res.status(500).json({ error: "Unable to load product review details." });
    }
  });

  router.get("/admin/products/:productId/files/:fileId/content", requireAdmin, async (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: "A valid product ID is required." });
    try {
      const file = await ProductFile.findOne({
        where: { UUID: req.params.fileId, ProductId: productId, IsActive: true },
      });
      if (!file) return res.status(404).json({ error: "Product file not found." });
      const document = await readProductFile(file.StorageKey);
      res.set({
        "Cache-Control": "no-store, private",
        "Content-Disposition": `attachment; filename="${String(file.FileName || "product-file").replace(/["\\r\\n]/g, "_")}"`,
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      return res.send(document.buffer);
    } catch (error) {
      console.error("Product file review retrieval failed", error);
      return res.status(500).json({ error: "Unable to retrieve product file." });
    }
  });

  router.get("/admin/products/:productId/history", requireAdmin, async (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: "A valid product ID is required." });
    try {
      const [rows] = await sequelize.query(
        `SELECT e."PreviousStatus" AS "previousStatus", e."NewStatus" AS "newStatus",
                e."Reason" AS reason, e."InternalNote" AS "internalNote",
                e."CreatedAt" AS "createdAt", ui."FullName" AS "actorName"
         FROM "ProductApprovalEvents" e
         LEFT JOIN "UserAccounts" ua ON ua."UserId" = e."ActorUserId"
         LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE e."ProductId" = :productId ORDER BY e."CreatedAt" DESC`,
        { replacements: { productId } },
      );
      return res.json({ history: rows });
    } catch (error) {
      console.error("Product approval history load failed", error);
      return res.status(500).json({ error: "Unable to load product approval history." });
    }
  });

  router.patch("/admin/products/:productId/approval", requireAdmin, async (req, res) => {
    const productId = Number(req.params.productId);
    const status = String(req.body.status || "").trim().toLowerCase();
    const reason = String(req.body.reason || "").trim();
    const internalNote = String(req.body.internalNote || "").trim();
    if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: "A valid product ID is required." });
    if (!["approved", "rejected", "changes_requested"].includes(status)) return res.status(400).json({ error: "Choose approved, rejected, or changes requested." });
    if (status !== "approved" && reason.length < 15) return res.status(400).json({ error: "Creator-visible feedback must be at least 15 characters for a rejection or change request." });
    if (reason.length > 2000) return res.status(400).json({ error: "Review reason must be 2,000 characters or fewer." });
    if (internalNote.length > 2000) return res.status(400).json({ error: "Internal note must be 2,000 characters or fewer." });

    try {
      const productResult = await sequelize.transaction(async (transaction) => {
        const product = await Product.findByPk(productId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!product) return { statusCode: 404, error: "Product not found." };
        const previousStatus = String(product.ApprovalStatus || "draft").toLowerCase();
        const canDecidePending = previousStatus === "pending";
        const canRevokeApproval = previousStatus === "approved" && status === "rejected";
        if (!canDecidePending && !canRevokeApproval) {
          return { statusCode: 409, error: "Pending products can receive approval decisions; approved products can only be rejected and unpublished." };
        }
        await product.update({
          ApprovalStatus: status,
          Status: status === "approved" && product.PublishAfterApproval ? "published" : "draft",
          PublishAfterApproval: status === "rejected" ? false : product.PublishAfterApproval,
          UpdatedAt: new Date(),
        }, { transaction });
        await sequelize.query(
          `INSERT INTO "ProductApprovalEvents"
             ("ProductId", "ActorUserId", "PreviousStatus", "NewStatus", "Reason", "InternalNote")
           VALUES (:productId, :actorUserId, :previousStatus, :status, :reason, :internalNote)`,
          {
            replacements: {
              productId,
              actorUserId: req.userId,
              previousStatus,
              status,
              reason: reason || null,
              internalNote: internalNote || null,
            },
            transaction,
          },
        );
        const [owner] = await sequelize.query(
          `SELECT cp."UserId" AS "creatorUserId", s."StoreName" AS "storeName"
           FROM "Products" p
           JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
           JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
           WHERE p."ProductId" = :productId`,
          { replacements: { productId }, type: QueryTypes.SELECT, transaction },
        );
        if (!owner) throw new Error("The product creator could not be found.");
        const decisionMessage = status === "approved"
          ? product.Status === "published"
            ? `${product.ProductName} was approved and is now published.`
            : `${product.ProductName} was approved and saved as a draft.`
          : `${product.ProductName} was ${status === "rejected" ? "rejected" : "returned for changes"}: ${reason}`;
        await createNotification(owner.creatorUserId, {
          type: `product.${status}`,
          title: status === "approved" ? "Product approved" : status === "rejected" ? "Product rejected" : "Changes requested",
          message: decisionMessage,
          relatedEntityType: "product",
          relatedEntityId: productId,
          href: `/creator/storefront/${encodeURIComponent(owner.storeName)}/products`,
          dedupeKey: `product-decision:${productId}:${status}:${new Date().getTime()}`,
        }, { transaction });
        return { product: serializeProduct(product) };
      });
      if (productResult.statusCode) return res.status(productResult.statusCode).json({ error: productResult.error });
      return res.json({ product: productResult.product });
    } catch (error) {
      console.error("Product approval update failed", error);
      return res.status(500).json({ error: "Unable to update product approval status." });
    }
  });

  router.post("/admin/products", requireAdmin, async (req, res) => {
    try {
      const name = String(req.body.name || "").trim();
      assertTextLimit("Product name", name, 40);
      assertTextLimit("Short description", req.body.shortDescription, 50);
      assertWordLimit("Product description", req.body.description, 50);
      assertTextLimit("Product price", req.body.price, 20);
      const slug = await uniqueProductSlug(req.body.slug || name);
      const price = Number(req.body.price);
      const discount = parseDiscount(req.body, price);
      let storefrontId = Number(req.body.storefrontId);
      let categoryId = Number(req.body.categoryId);
      if (!storefrontId) {
        const [storefronts] = await sequelize.query('SELECT "StorefrontId" FROM "Storefronts" ORDER BY "CreatedAt" ASC LIMIT 1');
        storefrontId = Number(storefronts[0]?.StorefrontId);
      }
      if (!categoryId) categoryId = await resolveCategoryId(req.body.categoryName);
      if (!name || !slug || !Number.isFinite(price) || price < 0 || !storefrontId || !categoryId) {
        return res.status(400).json({ error: "Name, price, storefront, and category are required." });
      }
      const created = await Product.create({
        UUID: crypto.randomUUID(),
        StorefrontId: storefrontId,
        CategoryId: categoryId,
        ProductName: name,
        Slug: slug,
        ShortDescription: String(req.body.shortDescription || "").trim(),
        Description: String(req.body.description || "").trim(),
        ProductType: String(req.body.productType || "Digital Download"),
        Price: price,
        DiscountPercent: discount.percent,
        DiscountType: discount.type,
        DiscountAmount: discount.amount,
        Currency: String(req.body.currency || "USD").slice(0, 3).toUpperCase(),
        Status: String(req.body.status || "draft").toLowerCase(),
        CreatedAt: new Date(),
        UpdatedAt: new Date(),
      });
      return res.status(201).json({ product: serializeProduct(created) });
    } catch (error) {
      return res.status(400).json({ error: error.message || "Unable to create product." });
    }
  });

  return router;
};
