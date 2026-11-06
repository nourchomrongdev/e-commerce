const express = require("express");
const { readEncryptedImage } = require("../services/encryptedImageService");
const { applyCreatorProgram, approveCreatorProfile } = require("../controllers/creatorProgramController");
const { createPaymentOrder, capturePaymentOrder } = require("../controllers/paymentController");
const { sequelize } = require("../models");

const publicProductWhere = `
  p."Status" = 'published'
  AND s."IsPublished" = TRUE
  AND s."IsActive" = TRUE
`;

const currentPriceSql = `CASE
  WHEN COALESCE(v."IsFree", FALSE) THEN 0
  WHEN p."DiscountType" = 'percentage'
    THEN GREATEST(COALESCE(v."Price", p."Price") * (1 - p."DiscountAmount" / 100), 0)
  WHEN p."DiscountType" = 'fixed'
    THEN GREATEST(COALESCE(v."Price", p."Price") - p."DiscountAmount", 0)
  ELSE COALESCE(v."Price", p."Price")
END`;

const productSelect = `
  WITH review_stats AS (
    SELECT "ProductId", AVG("Rating") AS rating, COUNT(*) AS "reviewCount"
    FROM "Reviews"
    WHERE "Status" = 'approved'
    GROUP BY "ProductId"
  ),
  sales_stats AS (
    SELECT i."ProductId",
      SUM(i."Quantity") FILTER (WHERE o."Status" IN ('paid', 'processing', 'completed')) AS "salesCount",
      SUM(i."Quantity") FILTER (
        WHERE o."Status" IN ('paid', 'processing', 'completed')
          AND o."CreatedAt" >= CURRENT_TIMESTAMP - INTERVAL '30 days'
      ) AS "recentSalesCount"
    FROM "OrderItems" i
    JOIN "Orders" o ON o."OrderId" = i."OrderId"
    GROUP BY i."ProductId"
  )
  SELECT
    p."ProductId" AS id,
    p."UUID" AS uuid,
    p."ProductName" AS name,
    p."Slug" AS slug,
    p."ShortDescription" AS "shortDescription",
    p."Description" AS description,
    p."ProductType" AS "productType",
    p."Price" AS "productPrice",
    p."DiscountType" AS "discountType",
    p."DiscountAmount" AS "discountAmount",
    p."Currency" AS currency,
    p."ThumbnailUrl" AS "thumbnailUrl",
    p."CreatedAt" AS "createdAt",
    p."UpdatedAt" AS "updatedAt",
    s."StoreName" AS "storeName",
    s."StoreSlug" AS "storeSlug",
    cp."DisplayName" AS "creatorName",
    cp."IsVerified" AS "creatorVerified",
    c."CategoryName" AS "categoryName",
    c."Slug" AS "categorySlug",
    v."ProductVersionId" AS "currentVersionId",
    v."VersionNumber" AS "currentVersion",
    v."IsFree" AS "isFree",
    CASE
      WHEN COALESCE(v."IsFree", FALSE) THEN 0
      ELSE COALESCE(v."Price", p."Price")
    END AS "versionPrice",
    ${currentPriceSql} AS "currentPrice",
    rs.rating,
    COALESCE(rs."reviewCount", 0) AS "reviewCount",
    COALESCE(ss."salesCount", 0) AS "salesCount",
    COALESCE(ss."recentSalesCount", 0) AS "recentSalesCount",
    preview."PreviewUrl" AS "previewUrl"
  FROM "Products" p
  JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
  JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId" AND cp."IsActive" = TRUE
  JOIN "Categories" c ON c."CategoryId" = p."CategoryId" AND c."IsActive" = TRUE
  LEFT JOIN review_stats rs ON rs."ProductId" = p."ProductId"
  LEFT JOIN sales_stats ss ON ss."ProductId" = p."ProductId"
  LEFT JOIN LATERAL (
    SELECT pv."ProductVersionId", pv."VersionNumber", pv."Price", pv."IsFree"
    FROM "ProductVersions" pv
    WHERE pv."ProductId" = p."ProductId"
    ORDER BY pv."IsCurrent" DESC, pv."CreatedAt" DESC, pv."ProductVersionId" DESC
    LIMIT 1
  ) v ON TRUE
  LEFT JOIN LATERAL (
    SELECT pa."PreviewUrl"
    FROM "ProductPreviews" pa
    WHERE pa."ProductId" = p."ProductId" AND pa."IsActive" = TRUE
    ORDER BY (pa."ProductVersionId" = v."ProductVersionId") DESC, pa."SortOrder", pa."ProductPreviewId"
    LIMIT 1
  ) preview ON TRUE
`;

function serializeProduct(row) {
  return {
    id: Number(row.id),
    uuid: row.uuid,
    name: row.name,
    slug: row.slug,
    shortDescription: row.shortDescription || "",
    description: row.description || "",
    productType: row.productType,
    categoryName: row.categoryName,
    categorySlug: row.categorySlug,
    storeName: row.storeName,
    storeSlug: row.storeSlug,
    creatorName: row.creatorName,
    creatorVerified: Boolean(row.creatorVerified),
    price: Number(row.currentPrice),
    currency: String(row.currency || "USD").trim(),
    discountType: row.discountType || "none",
    discountAmount: Number(row.discountAmount || 0),
    isFree: Boolean(row.isFree) || Number(row.currentPrice) === 0,
    currentVersion: row.currentVersion || null,
    currentVersionId: row.currentVersionId ? Number(row.currentVersionId) : null,
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    reviewCount: Number(row.reviewCount || 0),
    salesCount: Number(row.salesCount || 0),
    recentSalesCount: Number(row.recentSalesCount || 0),
    thumbnailUrl: row.thumbnailUrl || row.previewUrl || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parsePage(value) {
  const page = Number.parseInt(String(value || "1"), 10);
  return Number.isFinite(page) ? Math.min(Math.max(page, 1), 10000) : 1;
}

function parsePageSize(value) {
  const size = Number.parseInt(String(value || "24"), 10);
  return Number.isFinite(size) ? Math.min(Math.max(size, 1), 48) : 24;
}

function parseStringList(value, label) {
  if (value === undefined) return { values: [] };
  const rawValues = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (rawValues.length > 20 || rawValues.some((entry) => entry.length > 150 || !/^[\p{L}\p{N}][\p{L}\p{N} ./_+-]*$/u.test(entry))) {
    return { error: `Invalid ${label} filter.` };
  }
  return { values: [...new Set(rawValues)] };
}

function parsePrice(value, label) {
  if (value === undefined || value === "") return { value: null };
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0 || price > 1000000000) {
    return { error: `Invalid ${label} price.` };
  }
  return { value: price };
}

function getMarketplaceFilters(query) {
  const fields = [
    ["category", "category"],
    ["subcategory", "subcategory"],
    ["productType", "product type"],
    ["format", "file format"],
    ["license", "license"],
    ["store", "store"],
    ["creator", "creator"],
  ];
  const filters = {
    category: [],
    subcategory: [],
    productType: [],
    format: [],
    license: [],
    store: [],
    creator: [],
  };
  for (const [key, label] of fields) {
    const result = parseStringList(query[key], label);
    if (result.error) return { error: result.error };
    filters[key] = result.values;
  }

  const minPrice = parsePrice(query.minPrice, "minimum");
  const maxPrice = parsePrice(query.maxPrice, "maximum");
  if (minPrice.error || maxPrice.error) return { error: minPrice.error || maxPrice.error };
  if (minPrice.value !== null && maxPrice.value !== null && minPrice.value > maxPrice.value) {
    return { error: "Minimum price cannot exceed maximum price." };
  }

  let rating = null;
  if (query.rating !== undefined && query.rating !== "") {
    rating = Number(query.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return { error: "Rating must be between 1 and 5." };
    }
  }

  const availability = String(query.availability || "").toLowerCase();
  if (availability && availability !== "free" && availability !== "paid") {
    return { error: "Availability must be free or paid." };
  }
  const discounted = String(query.discounted || "").toLowerCase();
  if (discounted && discounted !== "true" && discounted !== "false") {
    return { error: "Discount filter must be true or false." };
  }
  const sort = String(query.sort || "popular").toLowerCase();
  const validSorts = ["relevance", "newest", "updated", "best_selling", "popular", "rating", "price_asc", "price_desc"];
  if (!validSorts.includes(sort)) return { error: "Unsupported marketplace sort." };

  return {
    filters: {
      ...filters,
      minPrice: minPrice.value,
      maxPrice: maxPrice.value,
      rating,
      availability,
      discounted: discounted === "true",
      sort,
    },
  };
}

function sendDatabaseError(res, error, message) {
  console.error(message, error);
  return res.status(500).json({ error: message });
}

module.exports = function createMarketplaceRoutes({ requireUser, requireAdmin }) {
  const router = express.Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok", service: "marketplace-api" });
  });

  router.get("/marketplace", async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: "Marketplace database is not configured." });
    try {
      const query = req.query as Record<string, unknown>;
      const search = String(query.search || "").trim().slice(0, 200);
      const page = parsePage(query.page);
      const pageSize = parsePageSize(query.pageSize);
      const parsedFilters = getMarketplaceFilters(query);
      if (parsedFilters.error) return res.status(400).json({ error: parsedFilters.error });
      const selected = parsedFilters.filters;
      const sort = selected.sort;
      const sortOrders = {
        relevance: 'CASE WHEN p."ProductName" ILIKE :exactSearch THEN 0 WHEN p."ProductName" ILIKE :search THEN 1 ELSE 2 END, COALESCE(ss."salesCount", 0) DESC, p."CreatedAt" DESC',
        popular: 'COALESCE(ss."salesCount", 0) DESC, rs.rating DESC NULLS LAST, p."CreatedAt" DESC',
        best_selling: 'COALESCE(ss."salesCount", 0) DESC, p."CreatedAt" DESC',
        newest: 'p."CreatedAt" DESC',
        updated: 'p."UpdatedAt" DESC',
        rating: 'rs.rating DESC NULLS LAST, rs."reviewCount" DESC, p."CreatedAt" DESC',
        price_asc: '"currentPrice" ASC, p."CreatedAt" DESC',
        price_desc: '"currentPrice" DESC, p."CreatedAt" DESC',
      };
      const order = sortOrders[sort] || sortOrders.popular;
      const filters = [];
      const escapedSearch = search.replace(/[\\%_]/g, "\\$&");
      const replacements: Record<string, unknown> = {
        search: `%${escapedSearch}%`,
        exactSearch: search,
      };
      if (search) {
        filters.push('(p."ProductName" ILIKE :search OR p."ShortDescription" ILIKE :search OR p."Description" ILIKE :search OR s."StoreName" ILIKE :search OR c."CategoryName" ILIKE :search OR cp."DisplayName" ILIKE :search OR cp."Username" ILIKE :search OR p."ProductType" ILIKE :search)');
      }
      if (selected.category.length) {
        filters.push('EXISTS (SELECT 1 FROM "Categories" selected_category WHERE selected_category."Slug" IN (:category) AND (selected_category."CategoryId" = c."CategoryId" OR selected_category."CategoryId" = c."ParentCategoryId"))');
        replacements.category = selected.category;
      }
      if (selected.subcategory.length) {
        filters.push('c."Slug" IN (:subcategory)');
        replacements.subcategory = selected.subcategory;
      }
      if (selected.productType.length) {
        filters.push('LOWER(p."ProductType") IN (:productType)');
        replacements.productType = selected.productType;
      }
      if (selected.minPrice !== null) {
        filters.push(`(${currentPriceSql}) >= :minPrice`);
        replacements.minPrice = selected.minPrice;
      }
      if (selected.maxPrice !== null) {
        filters.push(`(${currentPriceSql}) <= :maxPrice`);
        replacements.maxPrice = selected.maxPrice;
      }
      if (selected.rating !== null) {
        filters.push('rs.rating >= :minimumRating');
        replacements.minimumRating = selected.rating;
      }
      if (selected.availability === "free") {
        filters.push('(COALESCE(v."IsFree", FALSE) = TRUE OR (' + currentPriceSql + ') = 0)');
      } else if (selected.availability === "paid") {
        filters.push('(COALESCE(v."IsFree", FALSE) = FALSE AND (' + currentPriceSql + ') > 0)');
      }
      if (selected.discounted) {
        filters.push('((p."DiscountType" IN (\'percentage\', \'fixed\') AND p."DiscountAmount" > 0) OR p."DiscountPercent" > 0)');
      }
      if (selected.store.length) {
        filters.push('(LOWER(s."StoreSlug") IN (:store) OR LOWER(s."StoreName") IN (:store))');
        replacements.store = selected.store;
      }
      if (selected.creator.length) {
        filters.push('(LOWER(cp."Username") IN (:creator) OR LOWER(cp."DisplayName") IN (:creator))');
        replacements.creator = selected.creator;
      }
      if (selected.license.length) {
        filters.push('EXISTS (SELECT 1 FROM "ProductVersionLicenses" pvl JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = pvl."LicenseTypeId" AND lt."IsActive" = TRUE WHERE pvl."ProductVersionId" = v."ProductVersionId" AND (LOWER(lt."LicenseName") IN (:license) OR CAST(lt."LicenseTypeId" AS TEXT) IN (:license)))');
        replacements.license = selected.license;
      }
      if (selected.format.length) {
        const formatConditions = selected.format.map((format, index) => {
          replacements[`formatPattern${index}`] = `%${format}`;
          replacements[`mimePattern${index}`] = `%/${format}`;
          return `(LOWER(pf."FileName") LIKE :formatPattern${index} OR LOWER(pf."MimeType") LIKE :mimePattern${index})`;
        });
        filters.push(`EXISTS (SELECT 1 FROM "ProductFiles" pf WHERE pf."ProductId" = p."ProductId" AND pf."IsActive" = TRUE AND (${formatConditions.join(" OR ")}))`);
      }
      const filterSql = filters.length ? `AND ${filters.join(" AND ")}` : "";
      const queryProducts = async (extraFilter = "", queryOrder = 'p."CreatedAt" DESC', limit = pageSize, offset = (page - 1) * pageSize) => {
        const [rows] = await sequelize.query(
          `${productSelect} WHERE ${publicProductWhere} ${extraFilter} ORDER BY ${queryOrder} LIMIT :limit OFFSET :offset`,
          { replacements: { ...replacements, limit, offset } },
        );
        return rows.map(serializeProduct);
      };
      if (query.suggestions === "true" && search) {
        const [products, countRows] = await Promise.all([
          queryProducts(filterSql, order),
          sequelize.query(
            `SELECT COUNT(*) AS total FROM (${productSelect} WHERE ${publicProductWhere} ${filterSql}) filtered_products`,
            { replacements },
          ),
        ]);
        return res.json({
          products,
          total: Number(countRows[0][0].total),
          page,
          pageSize,
        });
      }

      const [products, countRows, bestSellers, trending, newArrivals, recentlyUpdated, categories, creators, productTypes, subcategories, licenseTypes] = await Promise.all([
        queryProducts(filterSql, order),
        sequelize.query(
          `SELECT COUNT(*) AS total FROM (${productSelect} WHERE ${publicProductWhere} ${filterSql}) filtered_products`,
          { replacements },
        ),
        queryProducts('AND COALESCE(ss."salesCount", 0) > 0', 'COALESCE(ss."salesCount", 0) DESC, rs.rating DESC NULLS LAST, p."CreatedAt" DESC', 6, 0),
        queryProducts('AND COALESCE(ss."recentSalesCount", 0) > 0', 'COALESCE(ss."recentSalesCount", 0) DESC, rs.rating DESC NULLS LAST, p."UpdatedAt" DESC', 6, 0),
        queryProducts("", 'p."CreatedAt" DESC', 6, 0),
        queryProducts("", 'p."UpdatedAt" DESC', 6, 0),
        sequelize.query(
          `SELECT c."CategoryId" AS id, c."CategoryName" AS name, c."Slug" AS slug, c."ParentCategoryId" AS "parentId", parent."CategoryName" AS "parentName", parent."Slug" AS "parentSlug", COUNT(p."ProductId") AS "productCount" FROM "Categories" c LEFT JOIN "Categories" parent ON parent."CategoryId" = c."ParentCategoryId" JOIN "Products" p ON (p."CategoryId" = c."CategoryId" OR p."CategoryId" IN (SELECT child."CategoryId" FROM "Categories" child WHERE child."ParentCategoryId" = c."CategoryId")) AND p."Status" = 'published' JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId" AND s."IsPublished" = TRUE AND s."IsActive" = TRUE JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId" AND cp."IsActive" = TRUE WHERE c."IsActive" = TRUE AND c."ParentCategoryId" IS NULL GROUP BY c."CategoryId", parent."CategoryName", parent."Slug" ORDER BY c."CategoryName"`,
        ),
        sequelize.query(
          `SELECT s."StoreName" AS name, s."StoreSlug" AS slug, s."Description" AS description, s."LogoUrl" AS "logoUrl", cp."DisplayName" AS "creatorName", cp."IsVerified" AS verified, COUNT(DISTINCT p."ProductId") AS "productCount", AVG(r."Rating") AS rating, COUNT(DISTINCT r."ReviewId") AS "reviewCount" FROM "Storefronts" s JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId" AND cp."IsActive" = TRUE LEFT JOIN "Products" p ON p."StorefrontId" = s."StorefrontId" AND p."Status" = 'published' LEFT JOIN "Reviews" r ON r."ProductId" = p."ProductId" AND r."Status" = 'approved' WHERE s."IsPublished" = TRUE AND s."IsActive" = TRUE GROUP BY s."StorefrontId", cp."CreatorProfileId" ORDER BY COUNT(DISTINCT p."ProductId") DESC, s."StoreName" LIMIT 6`,
        ),
        sequelize.query(
          `SELECT DISTINCT LOWER(p."ProductType") AS value FROM "Products" p JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId" JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId" AND cp."IsActive" = TRUE WHERE ${publicProductWhere} ORDER BY value`,
        ),
        sequelize.query(
          `SELECT c."CategoryName" AS name, c."Slug" AS slug, c."ParentCategoryId" AS "parentId", parent."Slug" AS "parentSlug", COUNT(p."ProductId") AS "productCount" FROM "Categories" c JOIN "Categories" parent ON parent."CategoryId" = c."ParentCategoryId" JOIN "Products" p ON p."CategoryId" = c."CategoryId" JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId" JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId" AND cp."IsActive" = TRUE WHERE ${publicProductWhere} AND c."IsActive" = TRUE AND c."ParentCategoryId" IS NOT NULL GROUP BY c."CategoryId", parent."Slug" ORDER BY c."CategoryName"`,
        ),
        sequelize.query(
          `SELECT DISTINCT lt."LicenseName" AS value, lt."LicenseTypeId" AS id FROM "LicenseTypes" lt JOIN "ProductVersionLicenses" pvl ON pvl."LicenseTypeId" = lt."LicenseTypeId" JOIN "ProductVersions" pv ON pv."ProductVersionId" = pvl."ProductVersionId" JOIN "Products" p ON p."ProductId" = pv."ProductId" JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId" JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId" AND cp."IsActive" = TRUE WHERE ${publicProductWhere} AND lt."IsActive" = TRUE ORDER BY lt."LicenseName"`,
        ),
      ]);
      const countResult = countRows[0][0];
      return res.json({
        products,
        total: Number(countResult.total),
        page,
        pageSize,
        categories: categories[0].map((row) => ({ id: Number(row.id), name: row.name, slug: row.slug, productCount: Number(row.productCount), subcategories: [] })),
        subcategories: subcategories[0].map((row) => ({ value: row.slug, label: row.name, parentId: Number(row.parentId), parentSlug: row.parentSlug, productCount: Number(row.productCount) })),
        filters: {
          productTypes: productTypes[0].map((row) => ({ value: row.value, label: row.value })),
          licenseTypes: licenseTypes[0].map((row) => ({ id: Number(row.id), name: row.value })),
        },
        creators: creators[0].map((row) => ({
          name: row.name,
          slug: row.slug,
          description: row.description || "",
          logoUrl: row.logoUrl || null,
          creatorName: row.creatorName,
          verified: Boolean(row.verified),
          productCount: Number(row.productCount),
          rating: row.rating === null ? null : Number(row.rating),
          reviewCount: Number(row.reviewCount),
        })),
        bestSellers,
        trending,
        newArrivals,
        recentlyUpdated,
      });
    } catch (error) {
      return sendDatabaseError(res, error, "Unable to load marketplace products.");
    }
  });

  router.get("/marketplace/:storefrontSlug/:productSlug/versions", async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: "Marketplace database is not configured." });
    try {
      const [products] = await sequelize.query(
        `SELECT p."ProductId" FROM "Products" p JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId" JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId" AND cp."IsActive" = TRUE WHERE ${publicProductWhere} AND LOWER(s."StoreSlug") = LOWER(:storefrontSlug) AND LOWER(p."Slug") = LOWER(:productSlug) LIMIT 1`,
        { replacements: { storefrontSlug: req.params.storefrontSlug, productSlug: req.params.productSlug } },
      );
      if (!products[0]) return res.status(404).json({ error: "Product not found." });
      const [versions] = await sequelize.query(
        `SELECT v."ProductVersionId" AS id, v."VersionNumber" AS version, v."ReleaseNotes" AS "releaseNotes", v."Price" AS price, v."IsFree" AS "isFree", v."IsCurrent" AS "isCurrent", v."CreatedAt" AS "releasedAt", COALESCE(files."fileCount", 0) AS "fileCount", COALESCE(files."fileSize", 0) AS "fileSize", COALESCE(files.files, '[]'::jsonb) AS files FROM "ProductVersions" v LEFT JOIN LATERAL (SELECT COUNT(*) AS "fileCount", SUM(f."FileSize") AS "fileSize", jsonb_agg(jsonb_build_object('name', f."FileName", 'size', f."FileSize", 'mimeType', f."MimeType")) AS files FROM "ProductFiles" f WHERE f."ProductVersionId" = v."ProductVersionId" AND f."IsActive" = TRUE) files ON TRUE WHERE v."ProductId" = :productId ORDER BY v."IsCurrent" DESC, v."CreatedAt" DESC, v."ProductVersionId" DESC`,
        { replacements: { productId: products[0].ProductId } },
      );
      return res.json({
        versions: versions.map((version) => ({
          id: Number(version.id),
          version: version.version,
          releaseNotes: version.releaseNotes || "",
          price: Number(version.price || 0),
          isFree: Boolean(version.isFree),
          isCurrent: Boolean(version.isCurrent),
          releasedAt: version.releasedAt,
          fileCount: Number(version.fileCount),
          fileSize: Number(version.fileSize || 0),
          files: version.files || [],
        })),
      });
    } catch (error) {
      return sendDatabaseError(res, error, "Unable to load product versions.");
    }
  });

  router.get("/marketplace/:storefrontSlug/:productSlug", async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: "Marketplace database is not configured." });
    try {
      const [rows] = await sequelize.query(
        `${productSelect} WHERE ${publicProductWhere} AND LOWER(s."StoreSlug") = LOWER(:storefrontSlug) AND LOWER(p."Slug") = LOWER(:productSlug) LIMIT 1`,
        { replacements: { storefrontSlug: req.params.storefrontSlug, productSlug: req.params.productSlug } },
      );
      if (!rows[0]) return res.status(404).json({ error: "Product not found." });
      const product = serializeProduct(rows[0]);
      const [previews, reviews, licenses] = await Promise.all([
        sequelize.query(
          `SELECT "PreviewType" AS type, "Title" AS title, "PreviewUrl" AS url, "SortOrder" AS "sortOrder" FROM "ProductPreviews" WHERE "ProductId" = :productId AND "IsActive" = TRUE ORDER BY "SortOrder", "ProductPreviewId"`,
          { replacements: { productId: product.id } },
        ),
        sequelize.query(
          `SELECT "ReviewId" AS id, "Rating" AS rating, "Title" AS title, "Comment" AS comment, "OrderItemId" IS NOT NULL AS "verifiedPurchase", "CreatedAt" AS "createdAt" FROM "Reviews" WHERE "ProductId" = :productId AND "Status" = 'approved' ORDER BY "CreatedAt" DESC LIMIT 20`,
          { replacements: { productId: product.id } },
        ),
        product.currentVersionId
          ? sequelize.query(
            `SELECT lt."LicenseTypeId" AS id, lt."LicenseName" AS name, vl."Price" AS price, vl."AccessType" AS "accessType", vl."DownloadLimit" AS "downloadLimit" FROM "ProductVersionLicenses" vl JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = vl."LicenseTypeId" AND lt."IsActive" = TRUE WHERE vl."ProductVersionId" = :versionId ORDER BY lt."LicenseName"`,
            { replacements: { versionId: product.currentVersionId } },
          )
          : Promise.resolve([[]]),
      ]);
      return res.json({
        product: {
          ...product,
          previews: previews[0].map((preview) => ({
            type: preview.type,
            title: preview.title || "",
            url: preview.url,
            sortOrder: Number(preview.sortOrder),
          })),
          reviews: reviews[0].map((review) => ({
            id: Number(review.id),
            rating: Number(review.rating),
            title: review.title || "",
            comment: review.comment || "",
            verifiedPurchase: Boolean(review.verifiedPurchase),
            createdAt: review.createdAt,
          })),
          licenses: licenses[0].map((license) => ({
            id: Number(license.id),
            name: license.name,
            price: Number(license.price || 0),
            accessType: license.accessType,
            downloadLimit: license.downloadLimit === null ? null : Number(license.downloadLimit),
          })),
        },
      });
    } catch (error) {
      return sendDatabaseError(res, error, "Unable to load product details.");
    }
  });

  router.get("/marketplace/:storefrontSlug", async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: "Marketplace database is not configured." });
    try {
      const query = req.query as Record<string, unknown>;
      const search = String(query.search || "").trim().slice(0, 200);
      const page = parsePage(query.page);
      const pageSize = parsePageSize(query.pageSize);
      const parsedFilters = getMarketplaceFilters(query);
      if (parsedFilters.error) return res.status(400).json({ error: parsedFilters.error });
      const selected = parsedFilters.filters;
      const sortOrders = {
        relevance: 'CASE WHEN p."ProductName" ILIKE :exactSearch THEN 0 WHEN p."ProductName" ILIKE :search THEN 1 ELSE 2 END, COALESCE(ss."salesCount", 0) DESC, p."CreatedAt" DESC',
        popular: 'COALESCE(ss."salesCount", 0) DESC, rs.rating DESC NULLS LAST, p."CreatedAt" DESC',
        best_selling: 'COALESCE(ss."salesCount", 0) DESC, p."CreatedAt" DESC',
        newest: 'p."CreatedAt" DESC',
        updated: 'p."UpdatedAt" DESC',
        rating: 'rs.rating DESC NULLS LAST, rs."reviewCount" DESC, p."CreatedAt" DESC',
        price_asc: '"currentPrice" ASC, p."CreatedAt" DESC',
        price_desc: '"currentPrice" DESC, p."CreatedAt" DESC',
      };
      const order = sortOrders[selected.sort] || sortOrders.popular;
      const filters = ['s."StorefrontId" = :storefrontId'];
      const replacements: Record<string, unknown> = {
        storefrontId: 0,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      };
      const escapedSearch = search.replace(/[\\%_]/g, "\\$&");
      if (search) {
        filters.push('(p."ProductName" ILIKE :search OR p."ShortDescription" ILIKE :search OR p."Description" ILIKE :search OR c."CategoryName" ILIKE :search OR p."ProductType" ILIKE :search)');
        replacements.search = `%${escapedSearch}%`;
        replacements.exactSearch = search;
      }
      if (selected.category.length) {
        filters.push('c."Slug" IN (:category)');
        replacements.category = selected.category;
      }
      if (selected.subcategory.length) {
        filters.push('c."Slug" IN (:subcategory)');
        replacements.subcategory = selected.subcategory;
      }
      if (selected.productType.length) {
        filters.push('LOWER(p."ProductType") IN (:productType)');
        replacements.productType = selected.productType;
      }
      if (selected.minPrice !== null) {
        filters.push(`(${currentPriceSql}) >= :minPrice`);
        replacements.minPrice = selected.minPrice;
      }
      if (selected.maxPrice !== null) {
        filters.push(`(${currentPriceSql}) <= :maxPrice`);
        replacements.maxPrice = selected.maxPrice;
      }
      if (selected.rating !== null) {
        filters.push('rs.rating >= :minimumRating');
        replacements.minimumRating = selected.rating;
      }
      if (selected.availability === "free") {
        filters.push('(COALESCE(v."IsFree", FALSE) = TRUE OR (' + currentPriceSql + ') = 0)');
      } else if (selected.availability === "paid") {
        filters.push('(COALESCE(v."IsFree", FALSE) = FALSE AND (' + currentPriceSql + ') > 0)');
      }
      if (selected.discounted) {
        filters.push('((p."DiscountType" IN (\'percentage\', \'fixed\') AND p."DiscountAmount" > 0) OR p."DiscountPercent" > 0)');
      }
      if (selected.license.length) {
        filters.push('EXISTS (SELECT 1 FROM "ProductVersionLicenses" pvl JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = pvl."LicenseTypeId" AND lt."IsActive" = TRUE WHERE pvl."ProductVersionId" = v."ProductVersionId" AND (LOWER(lt."LicenseName") IN (:license) OR CAST(lt."LicenseTypeId" AS TEXT) IN (:license)))');
        replacements.license = selected.license;
      }
      const [stores] = await sequelize.query(
        `SELECT s."StorefrontId" AS id, s."StoreName" AS name, s."StoreSlug" AS slug, s."Description" AS description, s."LogoUrl" AS "logoUrl", s."BannerUrl" AS "bannerUrl", s."WebsiteUrl" AS "websiteUrl", cp."DisplayName" AS "creatorName", cp."IsVerified" AS verified, COUNT(DISTINCT p."ProductId") AS "productCount", AVG(r."Rating") AS rating, COUNT(DISTINCT r."ReviewId") AS "reviewCount" FROM "Storefronts" s JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId" AND cp."IsActive" = TRUE LEFT JOIN "Products" p ON p."StorefrontId" = s."StorefrontId" AND p."Status" = 'published' LEFT JOIN "Reviews" r ON r."ProductId" = p."ProductId" AND r."Status" = 'approved' WHERE s."IsPublished" = TRUE AND s."IsActive" = TRUE AND LOWER(s."StoreSlug") = LOWER(:storefrontSlug) GROUP BY s."StorefrontId", cp."CreatorProfileId" LIMIT 1`,
        { replacements: { storefrontSlug: req.params.storefrontSlug } },
      );
      if (!stores[0]) return res.status(404).json({ error: "Storefront not found." });
      const storeRow = stores[0];
      replacements.storefrontId = storeRow.id;
      const filterSql = `AND ${filters.join(" AND ")}`;
      const [productsResult, countRows, categories, productTypes, licenseTypes] = await Promise.all([
        sequelize.query(
          `${productSelect} WHERE ${publicProductWhere} AND c."IsActive" = TRUE ${filterSql} ORDER BY ${order} LIMIT :limit OFFSET :offset`,
          { replacements },
        ),
        sequelize.query(
          `SELECT COUNT(*) AS total FROM "Products" p JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId" JOIN "Categories" c ON c."CategoryId" = p."CategoryId" JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId" AND cp."IsActive" = TRUE WHERE ${publicProductWhere} AND c."IsActive" = TRUE ${filterSql}`,
          { replacements },
        ),
        sequelize.query(
          `SELECT c."CategoryName" AS name, c."Slug" AS slug, COUNT(p."ProductId") AS "productCount" FROM "Categories" c JOIN "Products" p ON p."CategoryId" = c."CategoryId" AND p."Status" = 'published' JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId" WHERE s."StorefrontId" = :storefrontId AND s."IsPublished" = TRUE AND s."IsActive" = TRUE AND c."IsActive" = TRUE GROUP BY c."CategoryId" ORDER BY c."CategoryName"`,
          { replacements: { storefrontId: storeRow.id } },
        ),
        sequelize.query(
          `SELECT DISTINCT p."ProductType" AS value, p."ProductType" AS label FROM "Products" p WHERE p."StorefrontId" = :storefrontId AND p."Status" = 'published' AND p."ProductType" IS NOT NULL AND p."ProductType" <> '' ORDER BY p."ProductType"`,
          { replacements: { storefrontId: storeRow.id } },
        ),
        sequelize.query(
          `SELECT DISTINCT lt."LicenseTypeId" AS id, lt."LicenseName" AS name FROM "ProductVersionLicenses" pvl JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = pvl."LicenseTypeId" AND lt."IsActive" = TRUE JOIN "ProductVersions" v ON v."ProductVersionId" = pvl."ProductVersionId" JOIN "Products" p ON p."ProductId" = v."ProductId" WHERE p."StorefrontId" = :storefrontId AND p."Status" = 'published' ORDER BY lt."LicenseName"`,
          { replacements: { storefrontId: storeRow.id } },
        ),
      ]);
      const [products] = productsResult;
      const [countResult] = countRows;
      const [categoryRows] = categories;
      const [productTypeRows] = productTypes;
      const [licenseTypeRows] = licenseTypes;
      return res.json({
        store: {
          id: Number(storeRow.id),
          name: storeRow.name,
          slug: storeRow.slug,
          description: storeRow.description || "",
          logoUrl: storeRow.logoUrl || null,
          bannerUrl: storeRow.bannerUrl || null,
          websiteUrl: storeRow.websiteUrl || null,
          creatorName: storeRow.creatorName,
          verified: Boolean(storeRow.verified),
          productCount: Number(storeRow.productCount),
          rating: storeRow.rating === null ? null : Number(storeRow.rating),
          reviewCount: Number(storeRow.reviewCount),
          categories: categoryRows.map((category) => ({
            name: category.name,
            slug: category.slug,
            productCount: Number(category.productCount),
          })),
        },
        products: products.map(serializeProduct),
        total: Number(countResult[0].total),
        page,
        pageSize,
        filters: {
          productTypes: productTypeRows,
          licenseTypes: licenseTypeRows,
        },
      });
    } catch (error) {
      return sendDatabaseError(res, error, "Unable to load storefront.");
    }
  });

  router.get("/media/storefronts/:fileName", async (req, res) => {
    try {
      const image = await readEncryptedImage(req.params.fileName);
      return res.type(image.mimeType).send(image.buffer);
    } catch {
      return res.status(404).json({ error: "Image not found." });
    }
  });

  router.post("/creator-program/apply", requireUser, applyCreatorProgram);
  router.post("/creator-program/approve", requireAdmin, approveCreatorProfile);
  router.post("/payments/paypal/order", createPaymentOrder);
  router.post("/payments/paypal/capture", capturePaymentOrder);

  return router;
};
