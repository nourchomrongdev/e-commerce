const express = require("express");
const crypto = require("crypto");
const { sequelize, Product, Storefront, CreatorProfile } = require("../models");

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
        where: { Status: "published" },
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
