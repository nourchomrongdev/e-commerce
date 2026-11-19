const express = require("express");
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models");
const { issueOrderLicenses } = require("../services/licenseService");
const { createNotification, notifyRoles } = require("../services/notificationService");

const router = express.Router();
const MAX_PAGE_SIZE = 100;

function getPagination(query) {
  const page = Number(query.page || 1);
  const pageSize = Number(query.pageSize || 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error("Page and pageSize must be positive integers.");
  }
  return { page, pageSize: Math.min(pageSize, MAX_PAGE_SIZE), offset: (page - 1) * Math.min(pageSize, MAX_PAGE_SIZE) };
}

function addDateFilters(query, conditions, replacements, column) {
  if (query.from) {
    const from = new Date(String(query.from));
    if (Number.isNaN(from.getTime())) throw new Error("The from date is invalid.");
    conditions.push(`${column} >= :fromDate`);
    replacements.fromDate = from;
  }
  if (query.to) {
    const to = new Date(String(query.to));
    if (Number.isNaN(to.getTime())) throw new Error("The to date is invalid.");
    conditions.push(`${column} < :toDate`);
    replacements.toDate = new Date(to.getTime() + 86_400_000);
  }
}

function getOrderReferenceCondition(reference, replacements) {
  const value = String(reference || "").trim();
  if (!value) throw new Error("An order reference is required.");
  replacements.orderReference = value;
  if (/^\d+$/.test(value)) {
    return `("o"."OrderId" = CAST(:orderReference AS bigint) OR "o"."OrderNumber" = :orderReference OR "o"."UUID"::text = :orderReference)`;
  }
  return `("o"."OrderNumber" = :orderReference OR "o"."UUID"::text = :orderReference)`;
}

function reportFailure(res, error, operation) {
  console.error(`${operation} failed`, error);
  return res.status(500).json({ error: `Unable to ${operation}.` });
}

function invalidRequest(res, error) {
  return res.status(400).json({ error: error.message });
}

async function findStorefront(storefrontName, userId) {
  const [storefront] = await sequelize.query(
    `SELECT s."StorefrontId", s."StoreName", s."StoreSlug"
     FROM "Storefronts" s
     JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
     WHERE cp."UserId" = :userId
       AND (LOWER(s."StoreName") = LOWER(:storefrontName)
         OR LOWER(s."StoreSlug") = LOWER(:storefrontName))
     LIMIT 1`,
    { replacements: { userId, storefrontName: decodeURIComponent(String(storefrontName || "")) }, type: QueryTypes.SELECT },
  );
  return storefront || null;
}

module.exports = function createCommerceRoutes({ requireUser, requireCreatorAccess, requireAdmin, requireReviewModerator, requireSuperAdmin }) {
  router.get("/buyer/overview", requireUser, async (req, res) => {
    try {
      const replacements = { userId: req.userId };
      const [stats] = await sequelize.query(
        `SELECT
           (SELECT COUNT(*)::int FROM "Orders" o WHERE o."UserId" = :userId) AS "totalOrders",
           (SELECT COUNT(DISTINCT oi."ProductId")::int
            FROM "OrderItems" oi JOIN "Orders" o ON o."OrderId" = oi."OrderId"
            WHERE o."UserId" = :userId AND (
              o."Status" IN ('paid', 'completed', 'partially_refunded', 'refunded')
              OR EXISTS (
                SELECT 1 FROM "Payments" p
                WHERE p."OrderId" = o."OrderId" AND p."PaidAt" IS NOT NULL
                  AND p."Status" IN ('paid', 'partially_refunded', 'refunded')
              )
            )) AS "purchasedProducts",
           (SELECT COALESCE(SUM(d."DownloadCount"), 0)::int
            FROM "Downloads" d WHERE d."UserId" = :userId) AS "totalDownloads",
           (SELECT COUNT(*)::int FROM "Licenses" l
            WHERE l."UserId" = :userId AND l."Status" = 'active'
              AND (l."ExpiresAt" IS NULL OR l."ExpiresAt" > CURRENT_TIMESTAMP)) AS "activeLicenses",
           (SELECT COUNT(*)::int FROM "BuyerWishlist" w WHERE w."UserId" = :userId) AS "wishlistItems"`,
        { replacements, type: QueryTypes.SELECT },
      );
      const recentOrders = await sequelize.query(
        `SELECT o."OrderId" AS id, o."OrderNumber" AS "orderNumber",
                o."Status" AS status, o."TotalAmount" AS "totalAmount",
                o."Currency" AS currency, o."CreatedAt" AS "createdAt",
                COALESCE((
                  SELECT string_agg(oi."ProductName", ', ' ORDER BY oi."OrderItemId")
                  FROM "OrderItems" oi WHERE oi."OrderId" = o."OrderId"
                ), '') AS products
         FROM "Orders" o WHERE o."UserId" = :userId
         ORDER BY o."CreatedAt" DESC, o."OrderId" DESC LIMIT 5`,
        { replacements, type: QueryTypes.SELECT },
      );
      const recentActivity = await sequelize.query(
        `SELECT activity, "createdAt", href FROM (
           SELECT 'Order ' || o."OrderNumber" || ' · ' || LOWER(o."Status"::text) AS activity,
                  o."CreatedAt" AS "createdAt",
                  '/buyer/purchases/' || o."OrderNumber" AS href
           FROM "Orders" o WHERE o."UserId" = :userId
           UNION ALL
           SELECT 'Downloaded ' || pf."FileName" AS activity,
                  d."DownloadedAt" AS "createdAt",
                  '/buyer/downloads' AS href
           FROM "Downloads" d
           JOIN "OrderItems" oi ON oi."OrderItemId" = d."OrderItemId"
           JOIN "Orders" o ON o."OrderId" = oi."OrderId"
           JOIN "ProductFiles" pf ON pf."ProductFileId" = d."ProductFileId"
           WHERE d."UserId" = :userId AND d."DownloadedAt" IS NOT NULL
         ) activity_log
         ORDER BY "createdAt" DESC LIMIT 6`,
        { replacements, type: QueryTypes.SELECT },
      );
      return res.json({
        stats: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number(value || 0)])),
        recentOrders,
        recentActivity,
      });
    } catch (error) {
      return reportFailure(res, error, "load buyer overview");
    }
  });

  router.get("/buyer/settings", requireUser, async (req, res) => {
    try {
      await sequelize.query(
        `INSERT INTO "BuyerPreferences" ("UserId") VALUES (:userId)
         ON CONFLICT ("UserId") DO NOTHING`,
        { replacements: { userId: req.userId } },
      );
      const [preferences] = await sequelize.query(
        `SELECT "EmailNotifications" AS "emailNotifications",
                "ProductUpdateNotifications" AS "productUpdateNotifications",
                "MarketingNotifications" AS "marketingNotifications",
                "UpdatedAt" AS "updatedAt"
         FROM "BuyerPreferences" WHERE "UserId" = :userId`,
        { replacements: { userId: req.userId }, type: QueryTypes.SELECT },
      );
      return res.json({ preferences });
    } catch (error) {
      return reportFailure(res, error, "load buyer settings");
    }
  });

  router.patch("/buyer/settings", requireUser, async (req, res) => {
    const preferenceFields = {
      emailNotifications: "EmailNotifications",
      productUpdateNotifications: "ProductUpdateNotifications",
      marketingNotifications: "MarketingNotifications",
    };
    const suppliedFields = Object.keys(preferenceFields).filter((field) => Object.prototype.hasOwnProperty.call(req.body || {}, field));
    if (suppliedFields.length === 0 || suppliedFields.some((field) => typeof req.body[field] !== "boolean")) {
      return res.status(400).json({ error: "Provide at least one notification preference as a boolean." });
    }
    const replacements = {
      userId: req.userId,
      emailNotifications: req.body.emailNotifications ?? null,
      productUpdateNotifications: req.body.productUpdateNotifications ?? null,
      marketingNotifications: req.body.marketingNotifications ?? null,
    };
    try {
      const [preferences] = await sequelize.query(
        `INSERT INTO "BuyerPreferences" (
           "UserId", "EmailNotifications", "ProductUpdateNotifications", "MarketingNotifications"
         ) VALUES (
           :userId,
           COALESCE(:emailNotifications, TRUE),
           COALESCE(:productUpdateNotifications, TRUE),
           COALESCE(:marketingNotifications, FALSE)
         )
         ON CONFLICT ("UserId") DO UPDATE SET
           "EmailNotifications" = COALESCE(:emailNotifications, "BuyerPreferences"."EmailNotifications"),
           "ProductUpdateNotifications" = COALESCE(:productUpdateNotifications, "BuyerPreferences"."ProductUpdateNotifications"),
           "MarketingNotifications" = COALESCE(:marketingNotifications, "BuyerPreferences"."MarketingNotifications"),
           "UpdatedAt" = CURRENT_TIMESTAMP
         RETURNING "EmailNotifications" AS "emailNotifications",
                   "ProductUpdateNotifications" AS "productUpdateNotifications",
                   "MarketingNotifications" AS "marketingNotifications",
                   "UpdatedAt" AS "updatedAt"`,
        { replacements, type: QueryTypes.SELECT },
      );
      return res.json({ preferences });
    } catch (error) {
      return reportFailure(res, error, "save buyer settings");
    }
  });

  router.get("/buyer/products/:productId/review-eligibility", requireUser, async (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: "A valid product ID is required." });
    try {
      const [eligibility] = await sequelize.query(
        `SELECT EXISTS (
           SELECT 1 FROM "OrderItems" oi
           JOIN "Orders" o ON o."OrderId" = oi."OrderId"
           WHERE oi."ProductId" = :productId AND o."UserId" = :userId
             AND o."Status" IN ('paid', 'completed')
         ) AS "hasPurchased",
         (SELECT r."Status" FROM "Reviews" r
          WHERE r."ProductId" = :productId AND r."UserId" = :userId
          LIMIT 1) AS "reviewStatus"`,
        { replacements: { productId, userId: req.userId }, type: QueryTypes.SELECT },
      );
      const hasPurchased = Boolean(eligibility.hasPurchased);
      const reviewStatus = eligibility.reviewStatus || null;
      const hasReviewed = Boolean(reviewStatus);
      return res.json({ hasPurchased, hasReviewed, reviewStatus, eligible: hasPurchased && !hasReviewed });
    } catch (error) {
      return reportFailure(res, error, "check product review eligibility");
    }
  });

  router.get("/buyer/reviews", requireUser, async (req, res) => {
    try {
      const [reviews, eligibleProducts] = await Promise.all([
        sequelize.query(
          `SELECT r."ReviewId" AS id, r."ProductId" AS "productId",
                  p."ProductName" AS "productName", r."Rating" AS rating,
                  r."Title" AS title, r."Comment" AS comment,
                  r."Status" AS status, r."CreatedAt" AS "createdAt",
                  r."UpdatedAt" AS "updatedAt"
           FROM "Reviews" r
           JOIN "Products" p ON p."ProductId" = r."ProductId"
           WHERE r."UserId" = :userId
           ORDER BY r."UpdatedAt" DESC, r."ReviewId" DESC
           LIMIT 100`,
          { replacements: { userId: req.userId }, type: QueryTypes.SELECT },
        ),
        sequelize.query(
          `SELECT DISTINCT p."ProductId" AS id, p."ProductName" AS name
           FROM "Products" p
           JOIN "OrderItems" oi ON oi."ProductId" = p."ProductId"
           JOIN "Orders" o ON o."OrderId" = oi."OrderId"
           WHERE o."UserId" = :userId
             AND o."Status" IN ('paid', 'completed')
             AND NOT EXISTS (
               SELECT 1 FROM "Reviews" r
               WHERE r."UserId" = :userId AND r."ProductId" = p."ProductId"
             )
           ORDER BY p."ProductName"`,
          { replacements: { userId: req.userId }, type: QueryTypes.SELECT },
        ),
      ]);
      return res.json({ reviews, eligibleProducts });
    } catch (error) {
      return reportFailure(res, error, "load buyer reviews");
    }
  });

  router.post("/buyer/reviews", requireUser, async (req, res) => {
    const productId = Number(req.body?.productId);
    const rating = Number(req.body?.rating);
    const title = String(req.body?.title || "").trim();
    const comment = String(req.body?.comment || "").trim();
    if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({ error: "Select a valid product." });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: "Rating must be between 1 and 5." });
    if (title.length > 255 || comment.length > 5000 || (!title && !comment)) {
      return res.status(400).json({ error: "Add a review title or comment (up to 5,000 characters)." });
    }

    try {
      const review = await sequelize.transaction(async (transaction) => {
        const [purchase] = await sequelize.query(
          `SELECT oi."OrderItemId"
           FROM "OrderItems" oi
           JOIN "Orders" o ON o."OrderId" = oi."OrderId"
           WHERE o."UserId" = :userId
             AND oi."ProductId" = :productId
             AND o."Status" IN ('paid', 'completed')
           LIMIT 1`,
          { replacements: { userId: req.userId, productId }, type: QueryTypes.SELECT, transaction },
        );
        if (!purchase) throw Object.assign(new Error("A completed purchase is required to review this product."), { statusCode: 403 });

        const [savedReview] = await sequelize.query(
          `INSERT INTO "Reviews" ("ProductId", "UserId", "OrderItemId", "Rating", "Title", "Comment", "Status")
           VALUES (:productId, :userId, :orderItemId, :rating, :title, :comment, 'pending')
           RETURNING "ReviewId" AS id, "ProductId" AS "productId",
                     "Rating" AS rating, "Title" AS title, "Comment" AS comment,
                     "Status" AS status, "CreatedAt" AS "createdAt"`,
          { replacements: { productId, userId: req.userId, orderItemId: purchase.OrderItemId, rating, title: title || null, comment: comment || null }, type: QueryTypes.SELECT, transaction },
        );
        const [product] = await sequelize.query(
          `SELECT p."ProductName" AS name, cp."UserId" AS "creatorUserId"
           FROM "Products" p
           JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
           JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
           WHERE p."ProductId" = :productId`,
          { replacements: { productId }, type: QueryTypes.SELECT, transaction },
        );
        if (!product) throw new Error("The reviewed product could not be found.");
        await createNotification(product.creatorUserId, {
          type: "review.received",
          title: "New product review",
          message: `A buyer reviewed ${product.name}. The review is pending moderation.`,
          relatedEntityType: "review",
          relatedEntityId: savedReview.id,
          href: "/creator/overview",
          dedupeKey: `review-submitted:creator:${savedReview.id}`,
        }, { transaction });
        await notifyRoles(["admin", "superadmin", "reviewer", "content reviewer"], {
          type: "review.pending",
          title: "Review awaiting moderation",
          message: `A new verified review for ${product.name} is awaiting moderation.`,
          relatedEntityType: "review",
          relatedEntityId: savedReview.id,
          href: "/reviewer/customer-reviews",
          dedupeKey: `review-submitted:moderators:${savedReview.id}`,
        }, { transaction, excludeUserIds: [req.userId] });
        return savedReview;
      });
      return res.status(201).json({ review });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      if (error.original?.code === "23505") return res.status(409).json({ error: "You have already reviewed this product." });
      return reportFailure(res, error, "save buyer review");
    }
  });

  router.post("/buyer/reviews/:reviewId/report", requireUser, async (req, res) => {
    const reviewId = Number(req.params.reviewId);
    const reason = String(req.body?.reason || "").trim();
    const details = String(req.body?.details || "").trim();
    const allowedReasons = ["spam", "offensive", "false_information", "other"];
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0) return res.status(400).json({ error: "A valid review ID is required." });
    if (!allowedReasons.includes(reason)) return res.status(400).json({ error: "Choose a valid report reason." });
    if (details.length > 2000 || (reason === "other" && !details)) {
      return res.status(400).json({ error: "Add details for this report (up to 2,000 characters)." });
    }

    try {
      const report = await sequelize.transaction(async (transaction) => {
        const [review] = await sequelize.query(
          `SELECT "UserId" AS "userId", "Status" AS status
           FROM "Reviews" WHERE "ReviewId" = :reviewId FOR UPDATE`,
          { replacements: { reviewId }, type: QueryTypes.SELECT, transaction },
        );
        if (!review) throw Object.assign(new Error("Review not found."), { statusCode: 404 });
        if (Number(review.userId) === Number(req.userId)) throw Object.assign(new Error("You cannot report your own review."), { statusCode: 403 });
        if (review.status !== "approved") throw Object.assign(new Error("Only published reviews can be reported."), { statusCode: 409 });

        const [savedReport] = await sequelize.query(
          `INSERT INTO "ReviewReports" ("ReviewId", "ReporterUserId", "Reason", "Details")
           VALUES (:reviewId, :reporterUserId, :reason, :details)
           RETURNING "ReviewReportId" AS id, "Status" AS status, "CreatedAt" AS "createdAt"`,
          { replacements: { reviewId, reporterUserId: req.userId, reason, details: details || null }, type: QueryTypes.SELECT, transaction },
        );
        await notifyRoles(["admin", "superadmin", "reviewer", "content reviewer"], {
          type: "review.reported",
          title: "Review report received",
          message: "A published review has been reported and needs moderation.",
          relatedEntityType: "review",
          relatedEntityId: reviewId,
          href: "/reviewer/reported-reviews",
          dedupeKey: `review-reported:${savedReport.id}`,
        }, { transaction, excludeUserIds: [req.userId] });
        return savedReport;
      });
      return res.status(201).json({ report });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      if (error.original?.code === "23505") return res.status(409).json({ error: "You have already reported this review." });
      return reportFailure(res, error, "submit review report");
    }
  });

  router.patch("/buyer/reviews/:reviewId", requireUser, async (req, res) => {
    const reviewId = Number(req.params.reviewId);
    const rating = Number(req.body?.rating);
    const title = String(req.body?.title || "").trim();
    const comment = String(req.body?.comment || "").trim();
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0) return res.status(400).json({ error: "A valid review ID is required." });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: "Rating must be between 1 and 5." });
    if (title.length > 255 || comment.length > 5000 || (!title && !comment)) {
      return res.status(400).json({ error: "Add a review title or comment (up to 5,000 characters)." });
    }

    try {
      const [review] = await sequelize.query(
        `UPDATE "Reviews"
         SET "Rating" = :rating, "Title" = :title, "Comment" = :comment, "Status" = 'pending'
         WHERE "ReviewId" = :reviewId AND "UserId" = :userId
         RETURNING "ReviewId" AS id, "ProductId" AS "productId",
                   "Rating" AS rating, "Title" AS title, "Comment" AS comment,
                   "Status" AS status, "CreatedAt" AS "createdAt", "UpdatedAt" AS "updatedAt"`,
        { replacements: { reviewId, userId: req.userId, rating, title: title || null, comment: comment || null }, type: QueryTypes.SELECT },
      );
      if (!review) return res.status(404).json({ error: "Review not found." });
      return res.json({ review });
    } catch (error) {
      return reportFailure(res, error, "update buyer review");
    }
  });

  router.delete("/buyer/reviews/:reviewId", requireUser, async (req, res) => {
    const reviewId = Number(req.params.reviewId);
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0) return res.status(400).json({ error: "A valid review ID is required." });
    try {
      const deleted = await sequelize.query(
        `DELETE FROM "Reviews" WHERE "ReviewId" = :reviewId AND "UserId" = :userId
         RETURNING "ReviewId"`,
        { replacements: { reviewId, userId: req.userId }, type: QueryTypes.SELECT },
      );
      if (!deleted.length) return res.status(404).json({ error: "Review not found." });
      return res.json({ success: true });
    } catch (error) {
      return reportFailure(res, error, "delete buyer review");
    }
  });

  const listCreatorReviews = (responsesOnly) => async (req, res) => {
    let pagination;
    try {
      pagination = getPagination(req.query);
      const storefront = await findStorefront(req.params.storefrontName, req.userId);
      if (!storefront) return res.status(404).json({ error: "Storefront not found." });
      const search = String(req.query.search || "").trim().slice(0, 200);
      const conditions = [
        'p."StorefrontId" = :storefrontId',
        'r."Status" = \'approved\'',
      ];
      const replacements: Record<string, string | number> = { storefrontId: storefront.StorefrontId, limit: pagination.pageSize, offset: pagination.offset };
      if (responsesOnly) conditions.push('rr."ReviewResponseId" IS NOT NULL');
      if (search) {
        conditions.push('(p."ProductName" ILIKE :search OR COALESCE(r."Title", \'\') ILIKE :search OR COALESCE(r."Comment", \'\') ILIKE :search OR COALESCE(ui."FullName", \'\') ILIKE :search)');
        replacements.search = `%${search}%`;
      }
      const where = conditions.join(" AND ");
      const [countRows, reviews] = await Promise.all([
        sequelize.query(
          `SELECT COUNT(*)::int AS total
           FROM "Reviews" r JOIN "Products" p ON p."ProductId" = r."ProductId"
           LEFT JOIN "ReviewResponses" rr ON rr."ReviewId" = r."ReviewId"
           LEFT JOIN "UserAccounts" ua ON ua."UserId" = r."UserId"
           LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
           WHERE ${where}`,
          { replacements, type: QueryTypes.SELECT },
        ),
        sequelize.query(
          `SELECT r."ReviewId" AS id, r."Rating" AS rating, r."Title" AS title,
                  r."Comment" AS comment, r."OrderItemId" IS NOT NULL AS "verifiedPurchase",
                  r."CreatedAt" AS "createdAt", r."UpdatedAt" AS "updatedAt",
                  p."ProductName" AS "productName",
                  COALESCE(NULLIF(ui."FullName", ''), NULLIF(ua."Username", ''), ui."Email") AS "customerName",
                  ui."Email" AS "customerEmail", ui."AvatarUrl" AS "customerAvatarUrl",
                  rr."Response" AS response, rr."UpdatedAt" AS "responseUpdatedAt"
           FROM "Reviews" r JOIN "Products" p ON p."ProductId" = r."ProductId"
           LEFT JOIN "ReviewResponses" rr ON rr."ReviewId" = r."ReviewId"
           LEFT JOIN "UserAccounts" ua ON ua."UserId" = r."UserId"
           LEFT JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
           WHERE ${where}
           ORDER BY r."CreatedAt" DESC, r."ReviewId" DESC
           LIMIT :limit OFFSET :offset`,
          { replacements, type: QueryTypes.SELECT },
        ),
      ]);
      const total = Number(countRows[0]?.total || 0);
      return res.json({
        reviews,
        pagination: { page: pagination.page, pageSize: pagination.pageSize, total, pages: Math.max(1, Math.ceil(total / pagination.pageSize)) },
      });
    } catch (error) {
      if (error instanceof Error && /positive integers/.test(error.message)) return invalidRequest(res, error);
      return reportFailure(res, error, "load creator reviews");
    }
  };

  router.get("/creator/storefronts/:storefrontName/reviews", requireCreatorAccess, listCreatorReviews(false));
  router.get("/creator/storefronts/:storefrontName/reviews/responses", requireCreatorAccess, listCreatorReviews(true));

  router.put("/creator/storefronts/:storefrontName/reviews/:reviewId/response", requireCreatorAccess, async (req, res) => {
    const reviewId = Number(req.params.reviewId);
    const responseText = String(req.body?.response || "").trim();
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0) return res.status(400).json({ error: "A valid review ID is required." });
    if (!responseText || responseText.length > 5000) return res.status(400).json({ error: "A review response is required and must be 5,000 characters or fewer." });
    try {
      const storefront = await findStorefront(req.params.storefrontName, req.userId);
      if (!storefront) return res.status(404).json({ error: "Storefront not found." });
      const saved = await sequelize.transaction(async (transaction) => {
        const [response] = await sequelize.query(
          `INSERT INTO "ReviewResponses" ("ReviewId", "CreatorProfileId", "Response")
           SELECT r."ReviewId", cp."CreatorProfileId", :response
           FROM "Reviews" r
           JOIN "Products" p ON p."ProductId" = r."ProductId"
           JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
           JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
           WHERE r."ReviewId" = :reviewId AND r."Status" = 'approved'
             AND p."StorefrontId" = :storefrontId AND cp."UserId" = :userId
           ON CONFLICT ("ReviewId") DO UPDATE
             SET "Response" = EXCLUDED."Response", "UpdatedAt" = CURRENT_TIMESTAMP
             WHERE "ReviewResponses"."CreatorProfileId" = EXCLUDED."CreatorProfileId"
           RETURNING "ReviewId" AS "reviewId", "Response" AS response, "UpdatedAt" AS "updatedAt"`,
          { replacements: { reviewId, response: responseText, storefrontId: storefront.StorefrontId, userId: req.userId }, type: QueryTypes.SELECT, transaction },
        );
        if (!response) return null;
        const [review] = await sequelize.query(
          `SELECT r."UserId" AS "buyerUserId", p."ProductName" AS "productName"
           FROM "Reviews" r JOIN "Products" p ON p."ProductId" = r."ProductId"
           WHERE r."ReviewId" = :reviewId`,
          { replacements: { reviewId }, type: QueryTypes.SELECT, transaction },
        );
        if (review) {
          await createNotification(review.buyerUserId, {
            type: "review.response",
            title: "Creator responded to your review",
            message: `The creator replied to your review of ${review.productName}.`,
            relatedEntityType: "review",
            relatedEntityId: reviewId,
            href: "/buyer/reviews",
            dedupeKey: `review-response:${reviewId}:${new Date(response.updatedAt).getTime()}`,
          }, { transaction });
        }
        return response;
      });
      if (!saved) return res.status(404).json({ error: "An approved review for this storefront was not found." });
      return res.json({ response: saved });
    } catch (error) {
      return reportFailure(res, error, "save creator review response");
    }
  });

  router.delete("/creator/storefronts/:storefrontName/reviews/:reviewId/response", requireCreatorAccess, async (req, res) => {
    const reviewId = Number(req.params.reviewId);
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0) return res.status(400).json({ error: "A valid review ID is required." });
    try {
      const storefront = await findStorefront(req.params.storefrontName, req.userId);
      if (!storefront) return res.status(404).json({ error: "Storefront not found." });
      const deleted = await sequelize.query(
        `DELETE FROM "ReviewResponses" rr
         WHERE rr."ReviewId" = :reviewId
           AND rr."CreatorProfileId" = (SELECT "CreatorProfileId" FROM "CreatorProfiles" WHERE "UserId" = :userId)
           AND EXISTS (
             SELECT 1 FROM "Reviews" r JOIN "Products" p ON p."ProductId" = r."ProductId"
             WHERE r."ReviewId" = rr."ReviewId" AND p."StorefrontId" = :storefrontId
           )
         RETURNING rr."ReviewId"`,
        { replacements: { reviewId, userId: req.userId, storefrontId: storefront.StorefrontId }, type: QueryTypes.SELECT },
      );
      if (!deleted.length) return res.status(404).json({ error: "Review response not found." });
      return res.json({ success: true });
    } catch (error) {
      return reportFailure(res, error, "delete creator review response");
    }
  });

  router.get("/admin/reviews", requireReviewModerator, async (req, res) => {
    let pagination;
    try {
      pagination = getPagination(req.query);
      const status = String(req.query.status || "").trim().toLowerCase();
      const validStatuses = ["pending", "approved", "rejected", "hidden", "flagged", "removed"];
      if (status && !validStatuses.includes(status)) return res.status(400).json({ error: "Invalid review status filter." });
      const search = String(req.query.search || "").trim().slice(0, 200);
      const conditions = [];
      const replacements: Record<string, string | number> = { limit: pagination.pageSize, offset: pagination.offset };
      if (status) {
        conditions.push('r."Status" = :status');
        replacements.status = status;
      }
      if (search) {
        conditions.push('(p."ProductName" ILIKE :search OR COALESCE(r."Title", \'\') ILIKE :search OR COALESCE(r."Comment", \'\') ILIKE :search OR COALESCE(ui."FullName", \'\') ILIKE :search OR COALESCE(ui."Email", \'\') ILIKE :search)');
        replacements.search = `%${search}%`;
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const [countRows, reviews, summaryRows, statusRows] = await Promise.all([
        sequelize.query(
          `SELECT COUNT(*)::int AS total
           FROM "Reviews" r JOIN "Products" p ON p."ProductId" = r."ProductId"
           JOIN "UserAccounts" ua ON ua."UserId" = r."UserId"
           JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId" ${where}`,
          { replacements, type: QueryTypes.SELECT },
        ),
        sequelize.query(
          `SELECT r."ReviewId" AS id, r."Rating" AS rating, r."Title" AS title,
                  r."Comment" AS comment, r."Status" AS status, r."CreatedAt" AS "createdAt",
                  p."ProductName" AS "productName", ui."FullName" AS "customerName",
                  ui."Email" AS "customerEmail", s."StoreName" AS "storeName",
                  EXISTS (
                    SELECT 1 FROM "OrderItems" oi
                    JOIN "Orders" o ON o."OrderId" = oi."OrderId"
                    JOIN "Payments" pay ON pay."OrderId" = o."OrderId"
                    WHERE oi."OrderItemId" = r."OrderItemId"
                      AND o."UserId" = r."UserId"
                      AND pay."PaidAt" IS NOT NULL
                      AND pay."Status" IN ('paid', 'partially_refunded', 'refunded')
                  ) AS "verifiedPurchase"
           FROM "Reviews" r JOIN "Products" p ON p."ProductId" = r."ProductId"
           JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
           JOIN "UserAccounts" ua ON ua."UserId" = r."UserId"
           JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
           ${where}
           ORDER BY r."CreatedAt" DESC, r."ReviewId" DESC
           LIMIT :limit OFFSET :offset`,
          { replacements, type: QueryTypes.SELECT },
        ),
        sequelize.query(
          `SELECT COUNT(*)::int AS total,
                  COALESCE(AVG("Rating"), 0)::numeric(4,2) AS "averageRating",
                  COUNT(*) FILTER (WHERE "Status" = 'approved')::int AS approved,
                  COUNT(*) FILTER (WHERE "Status" = 'pending')::int AS pending
           FROM "Reviews"`,
          { type: QueryTypes.SELECT },
        ),
        sequelize.query(
          `SELECT "Status"::text AS status, COUNT(*)::int AS count
           FROM "Reviews" GROUP BY "Status"`,
          { type: QueryTypes.SELECT },
        ),
      ]);
      const total = Number(countRows[0]?.total || 0);
      return res.json({
        reviews,
        summary: summaryRows[0],
        statusCounts: Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)])),
        pagination: { page: pagination.page, pageSize: pagination.pageSize, total, pages: Math.max(1, Math.ceil(total / pagination.pageSize)) },
      });
    } catch (error) {
      if (error instanceof Error && /positive integers/.test(error.message)) return invalidRequest(res, error);
      return reportFailure(res, error, "load review moderation queue");
    }
  });

  router.get("/admin/review-reports", requireReviewModerator, async (req, res) => {
    let pagination;
    try {
      pagination = getPagination(req.query);
      const status = String(req.query.status || "").trim().toLowerCase();
      if (status && !["pending", "dismissed", "actioned"].includes(status)) {
        return res.status(400).json({ error: "Invalid report status filter." });
      }
      const search = String(req.query.search || "").trim().slice(0, 200);
      const conditions = [];
      const replacements: Record<string, string | number> = { limit: pagination.pageSize, offset: pagination.offset };
      if (status) {
        conditions.push('rr."Status" = :status');
        replacements.status = status;
      }
      if (search) {
        conditions.push('(p."ProductName" ILIKE :search OR COALESCE(r."Title", \'\') ILIKE :search OR COALESCE(r."Comment", \'\') ILIKE :search OR COALESCE(ri."FullName", \'\') ILIKE :search OR COALESCE(ri."Email", \'\') ILIKE :search OR rr."Reason" ILIKE :search OR COALESCE(rr."Details", \'\') ILIKE :search)');
        replacements.search = `%${search}%`;
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const [countRows, reports, summaryRows] = await Promise.all([
        sequelize.query(
          `SELECT COUNT(*)::int AS total
           FROM "ReviewReports" rr
           JOIN "Reviews" r ON r."ReviewId" = rr."ReviewId"
           JOIN "Products" p ON p."ProductId" = r."ProductId"
           JOIN "UserAccounts" ua ON ua."UserId" = rr."ReporterUserId"
           JOIN "UserInfo" ri ON ri."UserInfoId" = ua."UserInfoId"
           ${where}`,
          { replacements, type: QueryTypes.SELECT },
        ),
        sequelize.query(
          `SELECT rr."ReviewReportId" AS id, rr."ReviewId" AS "reviewId",
                  rr."Reason" AS reason, rr."Details" AS details,
                  rr."Status" AS status, rr."CreatedAt" AS "createdAt",
                  rr."DecisionReason" AS "decisionReason",
                  r."Rating" AS rating, r."Title" AS title, r."Comment" AS comment,
                  r."Status" AS "reviewStatus", p."ProductName" AS "productName",
                  ri."FullName" AS "reporterName", ri."Email" AS "reporterEmail"
           FROM "ReviewReports" rr
           JOIN "Reviews" r ON r."ReviewId" = rr."ReviewId"
           JOIN "Products" p ON p."ProductId" = r."ProductId"
           JOIN "UserAccounts" ua ON ua."UserId" = rr."ReporterUserId"
           JOIN "UserInfo" ri ON ri."UserInfoId" = ua."UserInfoId"
           ${where}
           ORDER BY rr."CreatedAt" DESC, rr."ReviewReportId" DESC
           LIMIT :limit OFFSET :offset`,
          { replacements, type: QueryTypes.SELECT },
        ),
        sequelize.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE "Status" = 'pending')::int AS pending,
                  COUNT(*) FILTER (WHERE "Status" = 'actioned')::int AS actioned,
                  COUNT(*) FILTER (WHERE "Status" = 'dismissed')::int AS dismissed
           FROM "ReviewReports"`,
          { type: QueryTypes.SELECT },
        ),
      ]);
      const total = Number(countRows[0]?.total || 0);
      return res.json({
        reports,
        summary: summaryRows[0],
        pagination: { page: pagination.page, pageSize: pagination.pageSize, total, pages: Math.max(1, Math.ceil(total / pagination.pageSize)) },
      });
    } catch (error) {
      if (error instanceof Error && /positive integers/.test(error.message)) return invalidRequest(res, error);
      return reportFailure(res, error, "load review reports");
    }
  });

  router.patch("/admin/review-reports/:reportId", requireReviewModerator, async (req, res) => {
    const reportId = Number(req.params.reportId);
    const action = String(req.body?.action || "").trim().toLowerCase();
    const reason = String(req.body?.reason || "").trim();
    if (!Number.isSafeInteger(reportId) || reportId <= 0) return res.status(400).json({ error: "A valid report ID is required." });
    if (!["dismiss", "remove_review"].includes(action)) return res.status(400).json({ error: "Choose a valid report action." });
    if (reason.length > 2000) return res.status(400).json({ error: "Decision reason must be 2,000 characters or fewer." });

    try {
      const report = await sequelize.transaction(async (transaction) => {
        const [current] = await sequelize.query(
          `SELECT "ReviewId" AS "reviewId", "Status" AS status
           FROM "ReviewReports" WHERE "ReviewReportId" = :reportId FOR UPDATE`,
          { replacements: { reportId }, type: QueryTypes.SELECT, transaction },
        );
        if (!current) throw Object.assign(new Error("Review report not found."), { statusCode: 404 });
        if (current.status !== "pending") throw Object.assign(new Error("This report has already been reviewed."), { statusCode: 409 });

        const status = action === "dismiss" ? "dismissed" : "actioned";
        if (action === "remove_review") {
          const [review] = await sequelize.query(
            `SELECT "Status" AS status, "UserId" AS "buyerUserId", "ProductId" AS "productId"
             FROM "Reviews" WHERE "ReviewId" = :reviewId FOR UPDATE`,
            { replacements: { reviewId: current.reviewId }, type: QueryTypes.SELECT, transaction },
          );
          if (!review) throw Object.assign(new Error("The reported review no longer exists."), { statusCode: 404 });
          if (review.status !== "removed") {
            await sequelize.query(
              `UPDATE "Reviews" SET "Status" = 'removed', "UpdatedAt" = CURRENT_TIMESTAMP
               WHERE "ReviewId" = :reviewId`,
              { replacements: { reviewId: current.reviewId }, transaction },
            );
            await sequelize.query(
              `INSERT INTO "ReviewModerationEvents" ("ReviewId", "ActorUserId", "PreviousStatus", "NewStatus", "Reason")
               VALUES (:reviewId, :actorUserId, :previousStatus, 'removed', :reason)`,
              { replacements: { reviewId: current.reviewId, actorUserId: req.userId, previousStatus: review.status, reason: reason || "Removed after a user report." }, transaction },
            );
          }
        }

        const [updated] = await sequelize.query(
          `UPDATE "ReviewReports"
           SET "Status" = :status, "DecisionReason" = :reason,
               "ReviewedByUserId" = :reviewerId, "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "ReviewReportId" = :reportId
           RETURNING "ReviewReportId" AS id, "Status" AS status,
                     "DecisionReason" AS "decisionReason", "UpdatedAt" AS "updatedAt"`,
          { replacements: { reportId, status, reason: reason || null, reviewerId: req.userId }, type: QueryTypes.SELECT, transaction },
        );
        return updated;
      });
      return res.json({ report });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return reportFailure(res, error, "review report");
    }
  });

  router.patch("/admin/reviews/:reviewId/moderation", requireReviewModerator, async (req, res) => {
    const reviewId = Number(req.params.reviewId);
    const status = String(req.body?.status || "").trim().toLowerCase();
    const reason = String(req.body?.reason || "").trim();
    const allowedStatuses = ["approved", "rejected", "hidden", "flagged", "removed"];
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0) return res.status(400).json({ error: "A valid review ID is required." });
    if (!allowedStatuses.includes(status)) return res.status(400).json({ error: "Choose an allowed review moderation status." });
    if (status !== "approved" && !reason) return res.status(400).json({ error: "A review reason is required for this decision." });
    if (reason.length > 2000) return res.status(400).json({ error: "Review reason must be 2,000 characters or fewer." });
    try {
      const review = await sequelize.transaction(async (transaction) => {
        const [rows] = await sequelize.query(
          `SELECT "Status" AS status, "ProductId" AS "productId",
                  "UserId" AS "buyerUserId"
           FROM "Reviews" WHERE "ReviewId" = :reviewId FOR UPDATE`,
          { replacements: { reviewId }, type: QueryTypes.SELECT, transaction },
        );
        if (!rows) throw Object.assign(new Error("Review not found."), { statusCode: 404 });
        const allowed = {
          pending: ["approved", "rejected", "flagged", "removed"],
          approved: ["hidden", "flagged", "removed"],
          rejected: ["pending", "removed"],
          hidden: ["approved", "removed"],
          flagged: ["approved", "rejected", "hidden", "removed"],
          removed: [],
        };
        if (!allowed[rows.status]?.includes(status)) throw Object.assign(new Error("This review cannot be changed from its current status."), { statusCode: 409 });
        const [updated] = await sequelize.query(
          `UPDATE "Reviews" SET "Status" = :status, "UpdatedAt" = CURRENT_TIMESTAMP
           WHERE "ReviewId" = :reviewId
           RETURNING "ReviewId" AS id, "Status" AS status, "UpdatedAt" AS "updatedAt"`,
          { replacements: { reviewId, status }, type: QueryTypes.SELECT, transaction },
        );
        const [moderationEvent] = await sequelize.query(
          `INSERT INTO "ReviewModerationEvents" ("ReviewId", "ActorUserId", "PreviousStatus", "NewStatus", "Reason")
           VALUES (:reviewId, :actorUserId, :previousStatus, :status, :reason)
           RETURNING "ReviewModerationEventId" AS id`,
          { replacements: { reviewId, actorUserId: req.userId, previousStatus: rows.status, status, reason: reason || null }, type: QueryTypes.SELECT, transaction },
        );
        const [product] = await sequelize.query(
          `SELECT "ProductName" AS name FROM "Products" WHERE "ProductId" = :productId`,
          { replacements: { productId: rows.productId }, type: QueryTypes.SELECT, transaction },
        );
        await createNotification(rows.buyerUserId, {
          type: "review.moderated",
          title: "Review status updated",
          message: status === "approved"
            ? `Your review of ${product?.name || "a product"} has been approved and is now visible.`
            : `Your review of ${product?.name || "a product"} was marked ${status}${reason ? `: ${reason}` : "."}`,
          relatedEntityType: "review",
          relatedEntityId: reviewId,
          href: "/buyer/reviews",
          dedupeKey: `review-moderated:${moderationEvent.id}`,
        }, { transaction });
        return updated;
      });
      return res.json({ review });
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
      return reportFailure(res, error, "moderate review");
    }
  });

  router.get("/buyer/products", requireUser, async (req, res) => {
    let pagination;
    try {
      pagination = getPagination(req.query);
      const ordersMissingLicenses = await sequelize.query(
        `SELECT DISTINCT o."OrderId" AS id
         FROM "Orders" o
         JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
         WHERE o."UserId" = :userId
           AND o."Status" IN ('paid', 'completed')
           AND EXISTS (
             SELECT 1 FROM "Payments" pay
             WHERE pay."OrderId" = o."OrderId"
               AND pay."PaidAt" IS NOT NULL AND pay."Status" = 'paid'
           )
           AND NOT EXISTS (
             SELECT 1 FROM "Licenses" l WHERE l."OrderItemId" = oi."OrderItemId"
           )
         ORDER BY id`,
        { replacements: { userId: req.userId }, type: QueryTypes.SELECT },
      );
      for (const order of ordersMissingLicenses) {
        await issueOrderLicenses(order.id);
      }

      const searchCondition = req.query.search
        ? `AND (p."ProductName" ILIKE :search OR s."StoreName" ILIKE :search)`
        : "";
      const replacements = {
        userId: req.userId,
        ...(req.query.search ? { search: `%${String(req.query.search).trim()}%` } : {}),
      };
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*)::int AS total
         FROM "OrderItems" oi
         JOIN "Orders" o ON o."OrderId" = oi."OrderId"
         JOIN "Products" p ON p."ProductId" = oi."ProductId"
         JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
         WHERE o."UserId" = :userId AND (
           o."Status" IN ('paid', 'completed', 'partially_refunded', 'refunded')
           OR EXISTS (
             SELECT 1 FROM "Payments" pay
             WHERE pay."OrderId" = o."OrderId" AND pay."PaidAt" IS NOT NULL
               AND pay."Status" IN ('paid', 'partially_refunded', 'refunded')
           )
         ) ${searchCondition}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const products = await sequelize.query(
        `WITH purchases AS (
           SELECT oi."OrderItemId" AS "orderItemId", oi."ProductId",
                  oi."ProductVersionId" AS "purchasedVersionId",
                  oi."LicenseTypeId" AS "licenseTypeId",
                  o."OrderNumber" AS "orderNumber", o."CreatedAt" AS "purchasedAt",
                  pv."VersionNumber" AS "purchasedVersion"
           FROM "OrderItems" oi
           JOIN "Orders" o ON o."OrderId" = oi."OrderId"
           LEFT JOIN "ProductVersions" pv ON pv."ProductVersionId" = oi."ProductVersionId"
           WHERE o."UserId" = :userId AND (
             o."Status" IN ('paid', 'completed', 'partially_refunded', 'refunded')
             OR EXISTS (
               SELECT 1 FROM "Payments" pay
               WHERE pay."OrderId" = o."OrderId" AND pay."PaidAt" IS NOT NULL
                 AND pay."Status" IN ('paid', 'partially_refunded', 'refunded')
             )
           )
         )
         SELECT p."ProductId" AS id, purchases."orderItemId",
                purchases."orderNumber", p."UUID" AS uuid, p."ProductName" AS name,
                p."Slug" AS slug, COALESCE(product_preview."PreviewUrl", NULLIF(p."ThumbnailUrl", '')) AS "thumbnailUrl",
                p."Status"::text AS status, s."StoreName" AS "storeName",
                s."StoreSlug" AS "storeSlug", purchases."purchasedAt",
                purchases."purchasedVersion", current_version."VersionNumber" AS "currentVersion",
                owned_license."LicenseId" AS "licenseId",
                (SELECT COUNT(*)::int FROM "ProductFiles" pf
                 WHERE pf."ProductId" = p."ProductId" AND pf."IsActive" = TRUE
                   AND ((purchases."purchasedVersionId" IS NULL AND pf."ProductVersionId" IS NULL)
                     OR pf."ProductVersionId" = purchases."purchasedVersionId")) AS "fileCount",
                (current_version."ProductVersionId" IS NOT NULL
                  AND current_version."ProductVersionId" IS DISTINCT FROM purchases."purchasedVersionId"
                  AND EXISTS (
                    SELECT 1 FROM "ProductVersionLicenses" current_license
                    WHERE current_license."ProductVersionId" = current_version."ProductVersionId"
                      AND current_license."LicenseTypeId" = purchases."licenseTypeId"
                  )) AS "updateAvailable"
         FROM purchases JOIN "Products" p ON p."ProductId" = purchases."ProductId"
         JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
         LEFT JOIN LATERAL (
           SELECT pv."ProductVersionId", pv."VersionNumber"
           FROM "ProductVersions" pv WHERE pv."ProductId" = p."ProductId"
           ORDER BY pv."IsCurrent" DESC, pv."CreatedAt" DESC, pv."ProductVersionId" DESC LIMIT 1
         ) current_version ON TRUE
         LEFT JOIN LATERAL (
           SELECT pp."PreviewUrl"
           FROM "ProductPreviews" pp
           WHERE pp."ProductId" = p."ProductId" AND pp."IsActive" = TRUE
             AND LOWER(pp."PreviewType") = 'image'
           ORDER BY COALESCE(pp."ProductVersionId" = purchases."purchasedVersionId", FALSE) DESC,
                    pp."SortOrder", pp."ProductPreviewId"
           LIMIT 1
         ) product_preview ON TRUE
         LEFT JOIN LATERAL (
           SELECT l."LicenseId"
           FROM "Licenses" l
           WHERE l."OrderItemId" = purchases."orderItemId" AND l."UserId" = :userId
             AND l."Status" = 'active'
             AND (l."ExpiresAt" IS NULL OR l."ExpiresAt" > CURRENT_TIMESTAMP)
           ORDER BY l."LicenseId"
           LIMIT 1
         ) owned_license ON TRUE
         WHERE TRUE ${searchCondition}
         ORDER BY purchases."purchasedAt" DESC, purchases."orderItemId" DESC
         LIMIT :pageSize OFFSET :offset`,
        { replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset }, type: QueryTypes.SELECT },
      );
      return res.json({
        products,
        pagination: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          total: Number(countRow.total),
          totalPages: Math.ceil(countRow.total / pagination.pageSize),
        },
      });
    } catch (error) {
      if (!pagination) return invalidRequest(res, error);
      return reportFailure(res, error, "load buyer products");
    }
  });

  router.get("/buyer/wishlist", requireUser, async (req, res) => {
    let pagination;
    try {
      pagination = getPagination(req.query);
      const searchCondition = req.query.search
        ? `AND (p."ProductName" ILIKE :search OR s."StoreName" ILIKE :search)`
        : "";
      const replacements = {
        userId: req.userId,
        ...(req.query.search ? { search: `%${String(req.query.search).trim()}%` } : {}),
      };
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*)::int AS total FROM "BuyerWishlist" w
         JOIN "Products" p ON p."ProductId" = w."ProductId"
         JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
         WHERE w."UserId" = :userId ${searchCondition}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const products = await sequelize.query(
        `SELECT w."WishlistId" AS "wishlistId", w."CreatedAt" AS "savedAt",
                p."ProductId" AS id, p."UUID" AS uuid, p."ProductName" AS name,
                p."Slug" AS slug, p."ThumbnailUrl" AS "thumbnailUrl",
                p."Currency" AS currency,
                p."DiscountType" AS "discountType", p."DiscountAmount" AS "discountAmount",
                CASE
                  WHEN COALESCE(v."IsFree", FALSE) THEN 0
                  WHEN p."DiscountType" = 'percentage'
                    THEN GREATEST(COALESCE(v."Price", p."Price") * (1 - p."DiscountAmount" / 100), 0)
                  WHEN p."DiscountType" = 'fixed'
                    THEN GREATEST(COALESCE(v."Price", p."Price") - p."DiscountAmount", 0)
                  ELSE COALESCE(v."Price", p."Price")
                END AS price,
                COALESCE(v."IsFree", FALSE) AS "isFree",
                p."Status"::text AS status, s."StoreName" AS "storeName",
                s."StoreSlug" AS "storeSlug", s."IsPublished" AS "storePublished",
                (p."Status" = 'published' AND s."IsPublished" = TRUE AND s."IsActive" = TRUE) AS "isAvailable"
         FROM "BuyerWishlist" w
         JOIN "Products" p ON p."ProductId" = w."ProductId"
         JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
         LEFT JOIN LATERAL (
           SELECT pv."Price", pv."IsFree" FROM "ProductVersions" pv
           WHERE pv."ProductId" = p."ProductId"
           ORDER BY pv."IsCurrent" DESC, pv."CreatedAt" DESC, pv."ProductVersionId" DESC LIMIT 1
         ) v ON TRUE
         WHERE w."UserId" = :userId ${searchCondition}
         ORDER BY w."CreatedAt" DESC, w."WishlistId" DESC
         LIMIT :pageSize OFFSET :offset`,
        { replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset }, type: QueryTypes.SELECT },
      );
      return res.json({
        products,
        pagination: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          total: Number(countRow.total),
          totalPages: Math.ceil(countRow.total / pagination.pageSize),
        },
      });
    } catch (error) {
      if (!pagination) return invalidRequest(res, error);
      return reportFailure(res, error, "load buyer wishlist");
    }
  });

  router.post("/buyer/wishlist", requireUser, async (req, res) => {
    const productId = Number(req.body?.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: "A valid productId is required." });
    }
    try {
      const [row] = await sequelize.query(
        `INSERT INTO "BuyerWishlist" ("UserId", "ProductId")
         SELECT :userId, p."ProductId"
         FROM "Products" p JOIN "Storefronts" s ON s."StorefrontId" = p."StorefrontId"
         WHERE p."ProductId" = :productId AND p."Status" = 'published'
           AND s."IsPublished" = TRUE AND s."IsActive" = TRUE
         ON CONFLICT ("UserId", "ProductId") DO UPDATE SET "ProductId" = EXCLUDED."ProductId"
         RETURNING "WishlistId" AS id, "ProductId" AS "productId"`,
        { replacements: { userId: req.userId, productId }, type: QueryTypes.SELECT },
      );
      if (!row) return res.status(404).json({ error: "Published product not found." });
      return res.status(200).json({ wishlistItem: row });
    } catch (error) {
      return reportFailure(res, error, "save wishlist item");
    }
  });

  router.delete("/buyer/wishlist/:productId", requireUser, async (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: "A valid productId is required." });
    }
    try {
      const [removed] = await sequelize.query(
        `DELETE FROM "BuyerWishlist" WHERE "UserId" = :userId AND "ProductId" = :productId
         RETURNING "WishlistId"`,
        { replacements: { userId: req.userId, productId }, type: QueryTypes.SELECT },
      );
      if (!removed) return res.status(404).json({ error: "Wishlist item not found." });
      return res.json({ removed: true });
    } catch (error) {
      return reportFailure(res, error, "remove wishlist item");
    }
  });

  router.get("/buyer/orders", requireUser, async (req, res) => {
    let pagination;
    const conditions = ['o."UserId" = :userId'];
    const replacements: Record<string, string | number | Date> = { userId: req.userId };
    try {
      pagination = getPagination(req.query);
      if (req.query.status) {
        conditions.push('LOWER(o."Status"::text) = LOWER(:status)');
        replacements.status = String(req.query.status);
      }
      if (req.query.search) {
        conditions.push(`(
          o."OrderNumber" ILIKE :search OR EXISTS (
            SELECT 1 FROM "OrderItems" oi
            WHERE oi."OrderId" = o."OrderId" AND oi."ProductName" ILIKE :search
          ) OR EXISTS (
            SELECT 1 FROM "Payments" p
            WHERE p."OrderId" = o."OrderId" AND COALESCE(p."TransactionId", '') ILIKE :search
          )
        )`);
        replacements.search = `%${String(req.query.search).trim()}%`;
      }
      addDateFilters(req.query, conditions, replacements, 'o."CreatedAt"');
      const where = conditions.join(" AND ");
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*)::int AS total FROM "Orders" o WHERE ${where}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const orders = await sequelize.query(
        `SELECT o."OrderId" AS id, o."UUID" AS uuid, o."OrderNumber" AS "orderNumber",
                o."Subtotal" AS subtotal, o."DiscountAmount" AS "discountAmount",
                o."TaxAmount" AS "taxAmount", o."TotalAmount" AS "totalAmount",
                o."Currency" AS currency, o."Status" AS status,
                o."CreatedAt" AS "createdAt", o."CreatedAt" + INTERVAL '24 hours' AS "paymentDueAt",
                o."UpdatedAt" AS "updatedAt",
                (SELECT COUNT(*)::int FROM "OrderItems" oi WHERE oi."OrderId" = o."OrderId") AS "itemCount",
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'productId', oi."ProductId", 'productName', oi."ProductName",
                    'quantity', oi."Quantity", 'unitPrice', oi."UnitPrice",
                    'licenseTypeId', oi."LicenseTypeId",
                    'allowRepurchase', oi."AllowRepurchase",
                    'amount', oi."TotalAmount"
                  ) ORDER BY oi."OrderItemId")
                  FROM "OrderItems" oi WHERE oi."OrderId" = o."OrderId"
                ), '[]'::jsonb) AS items,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'provider', p."PaymentMethod", 'status', p."Status",
                    'transactionId', p."TransactionId", 'amount', p."Amount",
                    'currency', p."Currency"
                  ) ORDER BY p."CreatedAt" DESC)
                  FROM "Payments" p WHERE p."OrderId" = o."OrderId"
                ), '[]'::jsonb) AS payments
         FROM "Orders" o WHERE ${where}
         ORDER BY o."CreatedAt" DESC, o."OrderId" DESC
         LIMIT :pageSize OFFSET :offset`,
        { replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset }, type: QueryTypes.SELECT },
      );
      return res.json({ orders, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: countRow.total, totalPages: Math.ceil(countRow.total / pagination.pageSize) } });
    } catch (error) {
      if (!pagination) return invalidRequest(res, error);
      return reportFailure(res, error, "load buyer orders");
    }
  });

  router.get("/buyer/orders/:orderReference", requireUser, async (req, res) => {
    const replacements: Record<string, string | number | Date> = { userId: req.userId };
    try {
      const referenceCondition = getOrderReferenceCondition(req.params.orderReference, replacements);
      const [order] = await sequelize.query(
        `SELECT o."OrderId" AS id, o."UUID" AS uuid, o."OrderNumber" AS "orderNumber",
                o."Subtotal" AS subtotal, o."DiscountAmount" AS "discountAmount",
                o."TaxAmount" AS "taxAmount", o."TotalAmount" AS "totalAmount",
                o."Currency" AS currency, o."Status" AS status,
                o."CreatedAt" AS "createdAt", o."CreatedAt" + INTERVAL '24 hours' AS "paymentDueAt",
                o."UpdatedAt" AS "updatedAt"
         FROM "Orders" o
         WHERE o."UserId" = :userId AND ${referenceCondition}
         LIMIT 1`,
        { replacements, type: QueryTypes.SELECT },
      );
      if (!order) return res.status(404).json({ error: "Order not found." });
      const items = await sequelize.query(
        `SELECT oi."OrderItemId" AS id, oi."ProductId" AS "productId",
                oi."ProductName" AS "productName", oi."Quantity" AS quantity,
                oi."UnitPrice" AS "unitPrice", oi."DiscountAmount" AS "discountAmount",
                oi."TotalAmount" AS "totalAmount", oi."LicenseTypeId" AS "licenseTypeId",
                oi."ProductVersionId" AS "productVersionId",
                oi."LicenseTermsSnapshot" AS "licenseTerms",
                oi."AllowRepurchase" AS "allowRepurchase",
                s."StoreName" AS "storeName", s."StoreSlug" AS "storeSlug",
                COALESCE(order_preview."PreviewUrl", NULLIF(p."ThumbnailUrl", '')) AS "thumbnailUrl",
                p."Slug" AS "productSlug", lt."LicenseName" AS "licenseName",
                (SELECT COUNT(*)::int FROM "Licenses" l WHERE l."OrderItemId" = oi."OrderItemId") AS "licenseCount"
         FROM "OrderItems" oi JOIN "Storefronts" s ON s."StorefrontId" = oi."StorefrontId"
         JOIN "Products" p ON p."ProductId" = oi."ProductId"
         LEFT JOIN "LicenseTypes" lt ON lt."LicenseTypeId" = oi."LicenseTypeId"
         LEFT JOIN LATERAL (
           SELECT pp."PreviewUrl"
           FROM "ProductPreviews" pp
           WHERE pp."ProductId" = p."ProductId" AND pp."IsActive" = TRUE
             AND LOWER(pp."PreviewType") = 'image'
           ORDER BY COALESCE(pp."ProductVersionId" = oi."ProductVersionId", FALSE) DESC,
                    pp."SortOrder", pp."ProductPreviewId"
           LIMIT 1
         ) order_preview ON TRUE
         WHERE oi."OrderId" = :orderId ORDER BY oi."OrderItemId"`,
        { replacements: { orderId: order.id }, type: QueryTypes.SELECT },
      );
      const downloads = await sequelize.query(
        `SELECT oi."OrderItemId" AS "orderItemId",
                l."LicenseId" AS "licenseId",
                pf."ProductFileId" AS "fileId", pf."FileName" AS "fileName",
                pf."FileSize" AS "fileSize", pf."MimeType" AS "mimeType",
                COALESCE(SUM(d."DownloadCount"), 0)::int AS "downloadCount",
                pvl."DownloadLimit" AS "downloadLimit"
         FROM "OrderItems" oi
         JOIN "Orders" o ON o."OrderId" = oi."OrderId"
         JOIN "Licenses" l ON l."OrderItemId" = oi."OrderItemId"
           AND l."UserId" = :userId AND l."Status" = 'active'
           AND (l."ExpiresAt" IS NULL OR l."ExpiresAt" > CURRENT_TIMESTAMP)
         JOIN "ProductFiles" pf ON pf."ProductId" = oi."ProductId"
           AND pf."IsActive" = TRUE
           AND ((oi."ProductVersionId" IS NULL AND pf."ProductVersionId" IS NULL)
             OR pf."ProductVersionId" = oi."ProductVersionId")
         LEFT JOIN "ProductVersionLicenses" pvl
           ON pvl."ProductVersionId" = oi."ProductVersionId"
           AND pvl."LicenseTypeId" = oi."LicenseTypeId"
         LEFT JOIN "Downloads" d ON d."OrderItemId" = oi."OrderItemId"
           AND d."ProductFileId" = pf."ProductFileId" AND d."UserId" = :userId
         WHERE oi."OrderId" = :orderId
           AND EXISTS (
             SELECT 1 FROM "Payments" pay
             WHERE pay."OrderId" = o."OrderId" AND pay."PaidAt" IS NOT NULL
               AND pay."Status" IN ('paid', 'partially_refunded', 'refunded')
           )
         GROUP BY oi."OrderItemId", l."LicenseId", pf."ProductFileId",
                  pf."FileName", pf."FileSize", pf."MimeType", pvl."DownloadLimit"
         ORDER BY oi."OrderItemId", pf."FileName", l."LicenseId"`,
        { replacements: { orderId: order.id, userId: req.userId }, type: QueryTypes.SELECT },
      );
      const downloadsByItem = new Map<number, typeof downloads>();
      for (const file of downloads) {
        const orderItemId = Number(file.orderItemId);
        const files = downloadsByItem.get(orderItemId) || [];
        files.push(file);
        downloadsByItem.set(orderItemId, files);
      }
      for (const item of items) {
        item.productUrl = item.storeSlug && item.productSlug
          ? `/marketplace/${encodeURIComponent(item.storeSlug)}/${encodeURIComponent(item.productSlug)}`
          : null;
        item.downloads = downloadsByItem.get(Number(item.id)) || [];
      }
      const payments = await sequelize.query(
        `SELECT "PaymentId" AS id, "PaymentMethod" AS provider, "TransactionId" AS "transactionId",
                "Amount" AS amount, "Currency" AS currency, "Status" AS status,
                "PaidAt" AS "paidAt", "CreatedAt" AS "createdAt", "UpdatedAt" AS "updatedAt"
         FROM "Payments" WHERE "OrderId" = :orderId ORDER BY "CreatedAt" DESC, "PaymentId" DESC`,
        { replacements: { orderId: order.id }, type: QueryTypes.SELECT },
      );
      return res.json({ order, items, payments });
    } catch (error) {
      if (error instanceof Error && error.message.includes("reference")) return invalidRequest(res, error);
      return reportFailure(res, error, "load buyer order details");
    }
  });

  router.post("/buyer/orders/:orderReference/cancel", requireUser, async (req, res) => {
    try {
      const result = await sequelize.transaction(async (transaction) => {
        const replacements: Record<string, string | number | Date> = { userId: req.userId };
        const referenceCondition = getOrderReferenceCondition(req.params.orderReference, replacements);
        const [order] = await sequelize.query(
          `SELECT o."OrderId", o."Status"
           FROM "Orders" o
           WHERE o."UserId" = :userId AND ${referenceCondition}
           LIMIT 1 FOR UPDATE`,
          { replacements, type: QueryTypes.SELECT, transaction },
        );
        if (!order) return { status: 404, error: "Order not found." };
        if (!["pending", "failed"].includes(String(order.Status).toLowerCase())) {
          return { status: 409, error: "Only unpaid pending or failed orders can be canceled." };
        }
        const [blockingActivePayment] = await sequelize.query(
          `SELECT EXISTS (
             SELECT 1 FROM "Payments"
             WHERE "OrderId" = :orderId
               AND LOWER("Status"::text) IN ('pending', 'authorized')
               AND NOT (
                 LOWER("PaymentMethod") IN ('abayapayway', 'abapayway', 'payway', 'aba')
                 AND LOWER("Status"::text) = 'pending'
               )
           ) AS active`,
          { replacements: { orderId: order.OrderId }, type: QueryTypes.SELECT, transaction },
        );
        if (blockingActivePayment.active) {
          return {
            status: 409,
            error: "A non-cancelable payment attempt is awaiting confirmation. Wait for it to finish or expire before canceling.",
          };
        }
        await sequelize.query(
          `UPDATE "Orders" SET "Status" = 'cancelled'
           WHERE "OrderId" = :orderId`,
          { replacements: { orderId: order.OrderId }, transaction },
        );
        return { status: 200 };
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.json({ cancelled: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes("reference")) return invalidRequest(res, error);
      return reportFailure(res, error, "cancel buyer order");
    }
  });

  router.get("/buyer/payments", requireUser, async (req, res) => {
    try {
      const pagination = getPagination(req.query);
      const conditions = ['o."UserId" = :userId'];
      const replacements: Record<string, string | number | Date> = { userId: req.userId };
      if (req.query.status) {
        conditions.push('LOWER(p."Status"::text) = LOWER(:status)');
        replacements.status = String(req.query.status);
      }
      if (req.query.search) {
        conditions.push(`(o."OrderNumber" ILIKE :search OR COALESCE(p."TransactionId", '') ILIKE :search OR p."PaymentMethod" ILIKE :search)`);
        replacements.search = `%${String(req.query.search).trim()}%`;
      }
      addDateFilters(req.query, conditions, replacements, 'p."CreatedAt"');
      const where = conditions.join(" AND ");
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*)::int AS total FROM "Payments" p JOIN "Orders" o ON o."OrderId" = p."OrderId" WHERE ${where}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const payments = await sequelize.query(
        `SELECT p."PaymentId" AS id, o."OrderNumber" AS "orderNumber",
                p."PaymentMethod" AS provider, p."TransactionId" AS "transactionId",
                p."Amount" AS amount, p."Currency" AS currency, p."Status" AS status,
                p."PaidAt" AS "paidAt", p."CreatedAt" AS "createdAt", p."UpdatedAt" AS "updatedAt"
         FROM "Payments" p JOIN "Orders" o ON o."OrderId" = p."OrderId"
         WHERE ${where} ORDER BY p."CreatedAt" DESC, p."PaymentId" DESC
         LIMIT :pageSize OFFSET :offset`,
        { replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset }, type: QueryTypes.SELECT },
      );
      return res.json({ payments, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: countRow.total, totalPages: Math.ceil(countRow.total / pagination.pageSize) } });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("date") || error.message.includes("page"))) return invalidRequest(res, error);
      return reportFailure(res, error, "load buyer payment history");
    }
  });

  router.get("/buyer/downloads", requireUser, async (req, res) => {
    try {
      const pagination = getPagination(req.query);
      const conditions = [
        'l."UserId" = :userId',
        'l."Status" = \'active\'',
        '(l."ExpiresAt" IS NULL OR l."ExpiresAt" > CURRENT_TIMESTAMP)',
        'EXISTS (SELECT 1 FROM "Payments" pay WHERE pay."OrderId" = o."OrderId" AND pay."PaidAt" IS NOT NULL AND pay."Status" IN (\'paid\', \'partially_refunded\', \'refunded\'))',
      ];
      const replacements: Record<string, string | number | Date> = { userId: req.userId };
      if (req.query.search) {
        conditions.push('(p."ProductName" ILIKE :search OR pf."FileName" ILIKE :search)');
        replacements.search = `%${String(req.query.search).trim()}%`;
      }
      const where = conditions.join(" AND ");
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*)::int AS total
         FROM "Licenses" l
         JOIN "OrderItems" oi ON oi."OrderItemId" = l."OrderItemId"
         JOIN "Orders" o ON o."OrderId" = oi."OrderId"
         JOIN "Products" p ON p."ProductId" = oi."ProductId"
         JOIN "ProductFiles" pf ON pf."ProductId" = oi."ProductId" AND pf."IsActive" = TRUE
           AND (oi."ProductVersionId" IS NULL OR pf."ProductVersionId" = oi."ProductVersionId")
         WHERE ${where}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const downloads = await sequelize.query(
        `SELECT l."LicenseId" AS "licenseId", oi."OrderItemId" AS "orderItemId",
                o."OrderNumber" AS "orderNumber", o."CreatedAt" AS "purchasedAt",
                p."ProductName" AS "productName", pf."ProductFileId" AS "fileId",
                pf."FileName" AS "fileName", pf."FileSize" AS "fileSize", pf."MimeType" AS "mimeType",
                l."Status" AS "licenseStatus",
                l."ExpiresAt" AS "licenseExpiresAt",
                COALESCE(d."DownloadCount", 0)::int AS "downloadCount",
                d."DownloadedAt" AS "lastDownloadedAt",
                pvl."DownloadLimit" AS "downloadLimit"
         FROM "Licenses" l
         JOIN "OrderItems" oi ON oi."OrderItemId" = l."OrderItemId"
         JOIN "Orders" o ON o."OrderId" = oi."OrderId"
         JOIN "Products" p ON p."ProductId" = oi."ProductId"
         JOIN "ProductFiles" pf ON pf."ProductId" = oi."ProductId" AND pf."IsActive" = TRUE
           AND (oi."ProductVersionId" IS NULL OR pf."ProductVersionId" = oi."ProductVersionId")
         LEFT JOIN "ProductVersionLicenses" pvl ON pvl."ProductVersionId" = oi."ProductVersionId"
           AND pvl."LicenseTypeId" = oi."LicenseTypeId"
         LEFT JOIN "Downloads" d ON d."OrderItemId" = oi."OrderItemId"
           AND d."ProductFileId" = pf."ProductFileId" AND d."UserId" = l."UserId"
         WHERE ${where}
         ORDER BY o."CreatedAt" DESC, pf."CreatedAt", pf."ProductFileId"
         LIMIT :pageSize OFFSET :offset`,
        { replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset }, type: QueryTypes.SELECT },
      );
      return res.json({ downloads, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: countRow.total, totalPages: Math.ceil(countRow.total / pagination.pageSize) } });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("page") || error.message.includes("date"))) return invalidRequest(res, error);
      return reportFailure(res, error, "load buyer downloads");
    }
  });

  router.get("/creator/storefronts/:storefrontName/orders", requireCreatorAccess, async (req, res) => {
    try {
      const storefront = await findStorefront(req.params.storefrontName, req.userId);
      if (!storefront) return res.status(404).json({ error: "Storefront not found." });
      const pagination = getPagination(req.query);
      const conditions = ['oi."StorefrontId" = :storefrontId'];
      const replacements: Record<string, string | number | Date> = { storefrontId: storefront.StorefrontId };
      if (req.query.status) {
        conditions.push('LOWER(o."Status"::text) = LOWER(:status)');
        replacements.status = String(req.query.status);
      }
      if (req.query.search) {
        conditions.push(`(o."OrderNumber" ILIKE :search OR ui."FullName" ILIKE :search OR ui."Email" ILIKE :search
          OR EXISTS (SELECT 1 FROM "Payments" pay WHERE pay."OrderId" = o."OrderId" AND COALESCE(pay."TransactionId", '') ILIKE :search)
          OR EXISTS (SELECT 1 FROM "OrderItems" item WHERE item."OrderId" = o."OrderId" AND item."StorefrontId" = :storefrontId AND item."ProductName" ILIKE :search))`);
        replacements.search = `%${String(req.query.search).trim()}%`;
      }
      if (req.query.product) {
        conditions.push(`EXISTS (
          SELECT 1 FROM "OrderItems" item
          WHERE item."OrderId" = o."OrderId" AND item."StorefrontId" = :storefrontId
            AND item."ProductName" = :productName
        )`);
        replacements.productName = String(req.query.product);
      }
      addDateFilters(req.query, conditions, replacements, 'o."CreatedAt"');
      const where = conditions.join(" AND ");
      const [countRow] = await sequelize.query(
        `SELECT COUNT(DISTINCT o."OrderId")::int AS total
         FROM "Orders" o JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
         JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE ${where}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const orders = await sequelize.query(
        `SELECT o."OrderId" AS id, o."OrderNumber" AS "orderNumber", o."Status" AS status,
                o."CreatedAt" AS "createdAt", o."Currency" AS currency,
                ui."FullName" AS "buyerName", ui."Email" AS "buyerEmail",
                ui."AvatarUrl" AS "buyerAvatarUrl",
                SUM(oi."TotalAmount") AS "salesAmount", COUNT(oi."OrderItemId")::int AS "itemCount",
                ARRAY_AGG(oi."ProductName" ORDER BY oi."OrderItemId") AS products,
                (ARRAY_AGG(
                  COALESCE(product_preview."PreviewUrl", NULLIF(p."ThumbnailUrl", ''))
                  ORDER BY COALESCE(product_preview."PreviewUrl", NULLIF(p."ThumbnailUrl", '')) IS NULL,
                           oi."OrderItemId"
                ))[1] AS "productPreviewUrl"
         FROM "Orders" o JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
         JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         JOIN "Products" p ON p."ProductId" = oi."ProductId"
         LEFT JOIN LATERAL (
           SELECT pp."PreviewUrl"
           FROM "ProductPreviews" pp
           WHERE pp."ProductId" = p."ProductId" AND pp."IsActive" = TRUE
             AND LOWER(pp."PreviewType") = 'image'
           ORDER BY COALESCE(pp."ProductVersionId" = oi."ProductVersionId", FALSE) DESC,
                    pp."SortOrder", pp."ProductPreviewId"
           LIMIT 1
         ) product_preview ON TRUE
         WHERE ${where}
         GROUP BY o."OrderId", ui."FullName", ui."Email", ui."AvatarUrl"
         ORDER BY o."CreatedAt" DESC, o."OrderId" DESC
         LIMIT :pageSize OFFSET :offset`,
        { replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset }, type: QueryTypes.SELECT },
      );
      return res.json({ storefront: storefront.StoreName, orders, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: countRow.total, totalPages: Math.ceil(countRow.total / pagination.pageSize) } });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("page") || error.message.includes("date"))) return invalidRequest(res, error);
      return reportFailure(res, error, "load creator sales orders");
    }
  });

  router.get("/creator/storefronts/:storefrontName/customers", requireCreatorAccess, async (req, res) => {
    try {
      const storefront = await findStorefront(req.params.storefrontName, req.userId);
      if (!storefront) return res.status(404).json({ error: "Storefront not found." });

      const pagination = getPagination(req.query);
      const conditions = ["TRUE"];
      const replacements: Record<string, string | number> = { storefrontId: storefront.StorefrontId };
      if (req.query.status && ["Active", "Inactive"].includes(String(req.query.status))) {
        conditions.push(
          req.query.status === "Active"
            ? 'cs."lastOrder" >= CURRENT_TIMESTAMP - INTERVAL \'90 days\''
            : 'cs."lastOrder" < CURRENT_TIMESTAMP - INTERVAL \'90 days\'',
        );
      }
      if (req.query.segment && ["New", "Returning"].includes(String(req.query.segment))) {
        conditions.push(req.query.segment === "New" ? 'cs.orders = 1' : 'cs.orders > 1');
      }
      if (req.query.search) {
        conditions.push(`(
          ui."FullName" ILIKE :search OR ui."Email" ILIKE :search
          OR EXISTS (
            SELECT 1 FROM customer_orders co
            WHERE co."userId" = cs."userId" AND co."orderNumber" ILIKE :search
          )
        )`);
        replacements.search = `%${String(req.query.search).trim()}%`;
      }

      const customerOrdersCte = `WITH customer_orders AS (
        SELECT o."UserId" AS "userId", o."OrderId" AS "orderId",
               o."OrderNumber" AS "orderNumber", o."CreatedAt" AS "createdAt",
               o."Currency" AS currency, SUM(oi."TotalAmount") AS amount
        FROM "Orders" o
        JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
        WHERE oi."StorefrontId" = :storefrontId
          AND o."Status" IN ('paid', 'completed')
        GROUP BY o."UserId", o."OrderId", o."OrderNumber", o."CreatedAt", o."Currency"
      ), customer_summary AS (
        SELECT "userId", COUNT(*)::int AS orders, MAX("createdAt") AS "lastOrder"
        FROM customer_orders
        GROUP BY "userId"
      )`;

      const [stats] = await sequelize.query(
        `${customerOrdersCte}
         SELECT COUNT(*)::int AS "totalCustomers",
                COUNT(*) FILTER (WHERE orders = 1)::int AS "newCustomers",
                COUNT(*) FILTER (WHERE orders > 1)::int AS "returningCustomers"
         FROM customer_summary`,
        { replacements, type: QueryTypes.SELECT },
      );
      const averageOrderValues = await sequelize.query(
        `${customerOrdersCte}
         SELECT currency, AVG(amount) AS amount
         FROM customer_orders
         GROUP BY currency
         ORDER BY currency`,
        { replacements, type: QueryTypes.SELECT },
      );

      const where = conditions.join(" AND ");
      const [countRow] = await sequelize.query(
        `${customerOrdersCte}
         SELECT COUNT(*)::int AS total
         FROM customer_summary cs
         JOIN "UserAccounts" ua ON ua."UserId" = cs."userId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE ${where}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const customers = await sequelize.query(
        `${customerOrdersCte}, currency_spend AS (
           SELECT "userId", currency, SUM(amount) AS amount
           FROM customer_orders
           GROUP BY "userId", currency
         )
         SELECT cs."userId" AS id, ui."FullName" AS name, ui."Email" AS email,
                cs.orders, cs."lastOrder",
                CASE WHEN cs."lastOrder" >= CURRENT_TIMESTAMP - INTERVAL '90 days'
                     THEN 'Active' ELSE 'Inactive' END AS status,
                CASE WHEN cs.orders = 1 THEN 'New' ELSE 'Returning' END AS segment,
                COALESCE((
                  SELECT json_agg(json_build_object('currency', spend.currency, 'amount', spend.amount)
                                  ORDER BY spend.currency)
                  FROM currency_spend spend
                  WHERE spend."userId" = cs."userId"
                ), '[]'::json) AS "spendByCurrency"
         FROM customer_summary cs
         JOIN "UserAccounts" ua ON ua."UserId" = cs."userId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE ${where}
         ORDER BY cs."lastOrder" DESC, cs."userId" DESC
         LIMIT :pageSize OFFSET :offset`,
        {
          replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset },
          type: QueryTypes.SELECT,
        },
      );

      return res.json({
        customers,
        stats,
        averageOrderValues,
        pagination: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          total: countRow.total,
          totalPages: Math.ceil(countRow.total / pagination.pageSize),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Page")) return invalidRequest(res, error);
      return reportFailure(res, error, "load storefront customers");
    }
  });

  router.get("/creator/storefronts/:storefrontName/downloads", requireCreatorAccess, async (req, res) => {
    try {
      const storefront = await findStorefront(req.params.storefrontName, req.userId);
      if (!storefront) return res.status(404).json({ error: "Storefront not found." });

      const pagination = getPagination(req.query);
      const conditions = [
        'oi."StorefrontId" = :storefrontId',
        'd."DownloadedAt" IS NOT NULL',
        'd."DownloadCount" > 0',
      ];
      const replacements: Record<string, string | number | Date> = { storefrontId: storefront.StorefrontId };
      if (req.query.search) {
        conditions.push(`(
          ui."FullName" ILIKE :search OR ui."Email" ILIKE :search
          OR p."ProductName" ILIKE :search OR pf."FileName" ILIKE :search
          OR o."OrderNumber" ILIKE :search
        )`);
        replacements.search = `%${String(req.query.search).trim()}%`;
      }
      addDateFilters(req.query, conditions, replacements, 'd."DownloadedAt"');
      const where = conditions.join(" AND ");
      const joins = `FROM "Downloads" d
        JOIN "OrderItems" oi ON oi."OrderItemId" = d."OrderItemId"
        JOIN "Orders" o ON o."OrderId" = oi."OrderId"
        JOIN "Products" p ON p."ProductId" = oi."ProductId"
        JOIN "ProductFiles" pf ON pf."ProductFileId" = d."ProductFileId"
        JOIN "UserAccounts" ua ON ua."UserId" = d."UserId"
        JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"`;
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*)::int AS total ${joins} WHERE ${where}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const downloads = await sequelize.query(
        `SELECT d."DownloadId" AS id, d."DownloadedAt" AS "downloadedAt",
                ui."FullName" AS "customerName", ui."Email" AS "customerEmail",
                p."ProductName" AS "productName", pf."FileName" AS "fileName",
                d."DownloadCount" AS "downloadCount", d."IPAddress"::text AS "ipAddress"
         ${joins}
         WHERE ${where}
         ORDER BY d."DownloadedAt" DESC, d."DownloadId" DESC
         LIMIT :pageSize OFFSET :offset`,
        {
          replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset },
          type: QueryTypes.SELECT,
        },
      );
      return res.json({
        downloads,
        pagination: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          total: countRow.total,
          totalPages: Math.ceil(countRow.total / pagination.pageSize),
        },
      });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("page") || error.message.includes("date"))) return invalidRequest(res, error);
      return reportFailure(res, error, "load storefront download activity");
    }
  });

  router.get("/creator/storefronts/:storefrontName/refunds", requireCreatorAccess, async (req, res) => {
    try {
      const storefront = await findStorefront(req.params.storefrontName, req.userId);
      if (!storefront) return res.status(404).json({ error: "Storefront not found." });

      const pagination = getPagination(req.query);
      const conditions = [
        'oi."StorefrontId" = :storefrontId',
        'adjustment."AdjustmentType" = \'refund\'',
      ];
      const replacements: Record<string, string | number | Date> = { storefrontId: storefront.StorefrontId };
      if (req.query.search) {
        conditions.push(`(
          o."OrderNumber" ILIKE :search OR ui."FullName" ILIKE :search
          OR ui."Email" ILIKE :search OR p."ProductName" ILIKE :search
          OR COALESCE(adjustment."ExternalReference", '') ILIKE :search
          OR adjustment."Reason" ILIKE :search
        )`);
        replacements.search = `%${String(req.query.search).trim()}%`;
      }
      addDateFilters(req.query, conditions, replacements, 'adjustment."CreatedAt"');
      const where = conditions.join(" AND ");
      const joins = `FROM "CreatorEarningAdjustments" adjustment
        JOIN "CreatorEarnings" earning ON earning."CreatorEarningId" = adjustment."CreatorEarningId"
        JOIN "OrderItems" oi ON oi."OrderItemId" = earning."OrderItemId"
        JOIN "Orders" o ON o."OrderId" = earning."OrderId"
        JOIN "Products" p ON p."ProductId" = earning."ProductId"
        JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
        JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"`;
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*)::int AS total ${joins} WHERE ${where}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const refunds = await sequelize.query(
        `SELECT adjustment."CreatorEarningAdjustmentId" AS id,
                adjustment."ExternalReference" AS "refundReference",
                adjustment."CreatedAt" AS "createdAt",
                ui."FullName" AS "customerName", ui."Email" AS "customerEmail",
                p."ProductName" AS "productName",
                adjustment."ProviderAmount" AS amount, adjustment."Currency" AS currency,
                adjustment."Reason" AS reason, o."Status"::text AS status
         ${joins}
         WHERE ${where}
         ORDER BY adjustment."CreatedAt" DESC, adjustment."CreatorEarningAdjustmentId" DESC
         LIMIT :pageSize OFFSET :offset`,
        {
          replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset },
          type: QueryTypes.SELECT,
        },
      );
      return res.json({
        refunds,
        pagination: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          total: countRow.total,
          totalPages: Math.ceil(countRow.total / pagination.pageSize),
        },
      });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("page") || error.message.includes("date"))) return invalidRequest(res, error);
      return reportFailure(res, error, "load storefront refund history");
    }
  });

  router.get("/creator/storefronts/:storefrontName/orders/:orderReference", requireCreatorAccess, async (req, res) => {
    try {
      const storefront = await findStorefront(req.params.storefrontName, req.userId);
      if (!storefront) return res.status(404).json({ error: "Storefront not found." });
      const replacements: Record<string, string | number | Date> = { storefrontId: storefront.StorefrontId };
      const referenceCondition = getOrderReferenceCondition(req.params.orderReference, replacements);
      const [order] = await sequelize.query(
        `SELECT o."OrderId" AS id, o."OrderNumber" AS "orderNumber",
                o."Status" AS status, o."Currency" AS currency,
                o."CreatedAt" AS "createdAt", ui."FullName" AS "buyerName",
                ui."Email" AS "buyerEmail", SUM(oi."TotalAmount") AS "salesAmount"
         FROM "Orders" o JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
         JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE oi."StorefrontId" = :storefrontId AND ${referenceCondition}
         GROUP BY o."OrderId", ui."FullName", ui."Email" LIMIT 1`,
        { replacements, type: QueryTypes.SELECT },
      );
      if (!order) return res.status(404).json({ error: "Order not found for this storefront." });
      const items = await sequelize.query(
        `SELECT oi."OrderItemId" AS id, oi."ProductName" AS "productName",
                oi."Quantity" AS quantity, oi."UnitPrice" AS "unitPrice",
                oi."TotalAmount" AS "totalAmount"
         FROM "OrderItems" oi
         WHERE oi."OrderId" = :orderId AND oi."StorefrontId" = :storefrontId
         ORDER BY oi."OrderItemId"`,
        { replacements: { orderId: order.id, storefrontId: storefront.StorefrontId }, type: QueryTypes.SELECT },
      );
      const payments = await sequelize.query(
        `SELECT p."PaymentMethod" AS provider, p."TransactionId" AS "transactionId",
                (SELECT SUM(oi."TotalAmount") FROM "OrderItems" oi
                 WHERE oi."OrderId" = p."OrderId" AND oi."StorefrontId" = :storefrontId) AS amount,
                o."Currency" AS currency, p."Status" AS status,
                p."PaidAt" AS "paidAt", p."CreatedAt" AS "createdAt"
         FROM "Payments" p JOIN "Orders" o ON o."OrderId" = p."OrderId"
         WHERE p."OrderId" = :orderId
         ORDER BY p."CreatedAt" DESC`,
        { replacements: { orderId: order.id, storefrontId: storefront.StorefrontId }, type: QueryTypes.SELECT },
      );
      return res.json({ order, items, payments });
    } catch (error) {
      if (error instanceof Error && error.message.includes("reference")) return invalidRequest(res, error);
      return reportFailure(res, error, "load creator order details");
    }
  });

  router.get("/creator/storefronts/:storefrontName/earnings", requireCreatorAccess, async (req, res) => {
    try {
      const storefront = await findStorefront(req.params.storefrontName, req.userId);
      if (!storefront) return res.status(404).json({ error: "Storefront not found." });
      const replacements = { storefrontId: storefront.StorefrontId };
      const conditions = ['oi."StorefrontId" = :storefrontId'];
      addDateFilters(req.query, conditions, replacements, 'o."CreatedAt"');
      const where = conditions.join(" AND ");
      const summary = await sequelize.query(
        `SELECT o."Currency" AS currency,
                COUNT(DISTINCT o."OrderId")::int AS "totalOrders",
                COUNT(DISTINCT o."OrderId") FILTER (WHERE o."Status" IN ('paid', 'completed'))::int AS "successfulOrders",
                COUNT(DISTINCT o."OrderId") FILTER (WHERE o."Status" = 'pending')::int AS "pendingOrders",
                COUNT(DISTINCT o."OrderId") FILTER (WHERE o."Status" IN ('failed', 'cancelled'))::int AS "failedOrders",
                COALESCE(SUM(earning."SaleAmount"), 0) AS "grossSales",
                COALESCE(SUM(earning."MarketplaceCommission"), 0) AS "platformFee",
                COALESCE(SUM(earning."SaleAmount" - earning."MarketplaceCommission" -
                  COALESCE((SELECT SUM(adjustment."Amount")
                            FROM "CreatorEarningAdjustments" adjustment
                            WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"), 0)), 0) AS "creatorEarnings",
                COALESCE(SUM(oi."Quantity") FILTER (WHERE earning."CreatorEarningId" IS NOT NULL), 0)::int AS "unitsSold"
         FROM "Orders" o
         JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
         LEFT JOIN "CreatorEarnings" earning ON earning."OrderItemId" = oi."OrderItemId"
         WHERE ${where}
         GROUP BY o."Currency"
         ORDER BY o."Currency"`,
        { replacements, type: QueryTypes.SELECT },
      );
      const transactions = await sequelize.query(
        `SELECT o."OrderNumber" AS "orderNumber", oi."ProductName" AS description,
                earning."SaleAmount" AS amount, earning."MarketplaceCommission" AS "platformFee",
                earning."SaleAmount" - earning."MarketplaceCommission" -
                  COALESCE((SELECT SUM(adjustment."Amount")
                            FROM "CreatorEarningAdjustments" adjustment
                            WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"), 0) AS "creatorEarnings",
                earning."CommissionRate" AS "commissionRate",
                earning."Currency" AS currency,
                CASE
                  WHEN EXISTS (SELECT 1 FROM "CreatorEarningHolds" hold
                               WHERE hold."CreatorEarningId" = earning."CreatorEarningId"
                                 AND hold."ReleasedAt" IS NULL) THEN 'on_hold'
                  WHEN o."Status" IN ('refunded', 'partially_refunded') THEN o."Status"::text
                  WHEN earning."EligibilityAt" > CURRENT_TIMESTAMP THEN 'pending'
                  ELSE 'available'
                END AS status,
                earning."PaidAt" AS "createdAt"
         FROM "CreatorEarnings" earning
         JOIN "OrderItems" oi ON oi."OrderItemId" = earning."OrderItemId"
         JOIN "Orders" o ON o."OrderId" = earning."OrderId"
         WHERE ${where}
         ORDER BY earning."PaidAt" DESC, earning."OrderItemId" DESC
         LIMIT 50`,
        { replacements, type: QueryTypes.SELECT },
      );
      return res.json({ storefront: storefront.StoreName, summary, transactions });
    } catch (error) {
      if (error instanceof Error && error.message.includes("date")) return invalidRequest(res, error);
      return reportFailure(res, error, "load creator earnings");
    }
  });

  router.get("/creator/storefronts/:storefrontName/analytics", requireCreatorAccess, async (req, res) => {
    try {
      const storefront = await findStorefront(req.params.storefrontName, req.userId);
      if (!storefront) return res.status(404).json({ error: "Storefront not found." });
      const replacements: Record<string, string | number | Date> = { storefrontId: storefront.StorefrontId };
      const conditions = ['oi."StorefrontId" = :storefrontId'];
      addDateFilters(req.query, conditions, replacements, 'o."CreatedAt"');
      const where = conditions.join(" AND ");
      const successfulWhere = `${where} AND earning."CreatorEarningId" IS NOT NULL`;
      const currencies = await sequelize.query(
        `SELECT o."Currency" AS currency,
                COUNT(DISTINCT o."OrderId") FILTER (WHERE o."Status" IN ('paid', 'completed'))::int AS "successfulOrders",
                COUNT(DISTINCT o."OrderId") FILTER (WHERE o."Status" = 'pending')::int AS "pendingOrders",
                COUNT(DISTINCT o."OrderId") FILTER (WHERE o."Status" IN ('failed', 'cancelled'))::int AS "failedOrders",
                COALESCE(SUM(earning."SaleAmount"), 0) AS "grossSales",
                COALESCE(SUM(earning."MarketplaceCommission"), 0) AS "platformFee",
                COALESCE(SUM(earning."SaleAmount" - earning."MarketplaceCommission" -
                  COALESCE((SELECT SUM(adjustment."Amount")
                            FROM "CreatorEarningAdjustments" adjustment
                            WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"), 0)), 0) AS "creatorEarnings",
                COALESCE(SUM(oi."Quantity") FILTER (WHERE earning."CreatorEarningId" IS NOT NULL), 0)::int AS "unitsSold"
         FROM "Orders" o
         JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
         LEFT JOIN "CreatorEarnings" earning ON earning."OrderItemId" = oi."OrderItemId"
         WHERE ${where} GROUP BY o."Currency" ORDER BY o."Currency"`,
        { replacements, type: QueryTypes.SELECT },
      );
      const products = await sequelize.query(
        `SELECT oi."ProductId" AS "productId", oi."ProductName" AS "productName", o."Currency" AS currency,
                COUNT(DISTINCT o."OrderId")::int AS orders,
                COALESCE(SUM(oi."Quantity"), 0)::int AS "unitsSold",
                COALESCE(SUM(earning."SaleAmount"), 0) AS "grossSales",
                COALESCE(SUM(earning."MarketplaceCommission"), 0) AS "platformFee",
                COALESCE(SUM(earning."SaleAmount" - earning."MarketplaceCommission" -
                  COALESCE((SELECT SUM(adjustment."Amount")
                            FROM "CreatorEarningAdjustments" adjustment
                            WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"), 0)), 0) AS "creatorEarnings"
         FROM "Orders" o
         JOIN "OrderItems" oi ON oi."OrderId" = o."OrderId"
         JOIN "CreatorEarnings" earning ON earning."OrderItemId" = oi."OrderItemId"
         WHERE ${successfulWhere}
         GROUP BY oi."ProductId", oi."ProductName", o."Currency"
         ORDER BY SUM(earning."SaleAmount") DESC, oi."ProductName"`,
        { replacements, type: QueryTypes.SELECT },
      );
      const monthlySales = await sequelize.query(
        `SELECT DATE_TRUNC('month', earning."PaidAt") AS month, earning."Currency" AS currency,
                COUNT(DISTINCT o."OrderId")::int AS orders,
                COALESCE(SUM(earning."SaleAmount"), 0) AS revenue
         FROM "CreatorEarnings" earning
         JOIN "OrderItems" oi ON oi."OrderItemId" = earning."OrderItemId"
         JOIN "Orders" o ON o."OrderId" = earning."OrderId"
         WHERE ${successfulWhere}
         GROUP BY DATE_TRUNC('month', earning."PaidAt"), earning."Currency"
         ORDER BY month, earning."Currency"`,
        { replacements, type: QueryTypes.SELECT },
      );
      return res.json({ storefront: storefront.StoreName, currencies, products, monthlySales });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("date") || error.message.includes("page"))) return invalidRequest(res, error);
      return reportFailure(res, error, "load creator sales analytics");
    }
  });

  router.get("/admin/orders", requireSuperAdmin, async (req, res) => {
    try {
      const pagination = getPagination(req.query);
      const conditions = ["TRUE"];
      const replacements: Record<string, string | number | Date> = {};
      if (req.query.status) {
        conditions.push('LOWER(o."Status"::text) = LOWER(:status)');
        replacements.status = String(req.query.status);
      }
      if (req.query.search) {
        conditions.push(`(
          o."OrderNumber" ILIKE :search OR ui."FullName" ILIKE :search OR ui."Email" ILIKE :search
          OR EXISTS (SELECT 1 FROM "Payments" p WHERE p."OrderId" = o."OrderId" AND p."TransactionId" ILIKE :search)
          OR EXISTS (SELECT 1 FROM "OrderItems" oi JOIN "Storefronts" s ON s."StorefrontId" = oi."StorefrontId"
            JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
            JOIN "UserAccounts" cau ON cau."UserId" = cp."UserId"
            JOIN "UserInfo" cui ON cui."UserInfoId" = cau."UserInfoId"
            WHERE oi."OrderId" = o."OrderId" AND cui."FullName" ILIKE :search)
        )`);
        replacements.search = `%${String(req.query.search).trim()}%`;
      }
      addDateFilters(req.query, conditions, replacements, 'o."CreatedAt"');
      const where = conditions.join(" AND ");
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*)::int AS total
         FROM "Orders" o JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE ${where}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const orders = await sequelize.query(
        `SELECT o."OrderId" AS id, o."UUID" AS uuid, o."OrderNumber" AS "orderNumber",
                o."Status" AS status, o."Currency" AS currency, o."Subtotal" AS subtotal,
                o."DiscountAmount" AS "discountAmount", o."TaxAmount" AS "taxAmount",
                o."TotalAmount" AS "totalAmount", o."CreatedAt" AS "createdAt",
                ui."FullName" AS "buyerName", ui."Email" AS "buyerEmail",
                (SELECT string_agg(DISTINCT cui."FullName", ', ')
                 FROM "OrderItems" oi JOIN "Storefronts" s ON s."StorefrontId" = oi."StorefrontId"
                 JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
                 JOIN "UserAccounts" cau ON cau."UserId" = cp."UserId"
                 JOIN "UserInfo" cui ON cui."UserInfoId" = cau."UserInfoId"
                 WHERE oi."OrderId" = o."OrderId") AS creators,
                (SELECT jsonb_agg(jsonb_build_object(
                   'provider', p."PaymentMethod", 'transactionId', p."TransactionId",
                   'status', p."Status", 'amount', p."Amount"
                 ) ORDER BY p."CreatedAt" DESC) FROM "Payments" p WHERE p."OrderId" = o."OrderId") AS payments
         FROM "Orders" o JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE ${where}
         ORDER BY o."CreatedAt" DESC, o."OrderId" DESC
         LIMIT :pageSize OFFSET :offset`,
        { replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset }, type: QueryTypes.SELECT },
      );
      const [summary] = await sequelize.query(
        `SELECT COUNT(*)::int AS "totalOrders",
                COUNT(*) FILTER (WHERE "Status" IN ('paid', 'completed'))::int AS "successfulOrders",
                COUNT(*) FILTER (WHERE "Status" = 'pending')::int AS "pendingOrders",
                COUNT(*) FILTER (WHERE "Status" = 'processing')::int AS "processingOrders",
                COUNT(*) FILTER (WHERE "Status" IN ('failed', 'cancelled'))::int AS "failedOrders",
                COUNT(*) FILTER (WHERE "Status" IN ('refunded', 'partially_refunded'))::int AS "refundedOrders",
                COALESCE(SUM("TotalAmount") FILTER (WHERE "Status" IN ('paid', 'completed')), 0) AS "grossRevenue"
         FROM "Orders"`,
        { type: QueryTypes.SELECT },
      );
      return res.json({ orders, summary, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: countRow.total, totalPages: Math.ceil(countRow.total / pagination.pageSize) } });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("date") || error.message.includes("page"))) return invalidRequest(res, error);
      return reportFailure(res, error, "load admin orders");
    }
  });

  router.get("/admin/orders/:orderReference", requireSuperAdmin, async (req, res) => {
    const replacements: Record<string, string | number | Date> = {};
    try {
      const referenceCondition = getOrderReferenceCondition(req.params.orderReference, replacements);
      const [order] = await sequelize.query(
        `SELECT o."OrderId" AS id, o."UUID" AS uuid, o."OrderNumber" AS "orderNumber",
                o."Status" AS status, o."Currency" AS currency, o."Subtotal" AS subtotal,
                o."DiscountAmount" AS "discountAmount", o."TaxAmount" AS "taxAmount",
                o."TotalAmount" AS "totalAmount", o."CreatedAt" AS "createdAt",
                o."UpdatedAt" AS "updatedAt", ui."FullName" AS "buyerName",
                ui."Email" AS "buyerEmail"
         FROM "Orders" o JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE ${referenceCondition} LIMIT 1`,
        { replacements, type: QueryTypes.SELECT },
      );
      if (!order) return res.status(404).json({ error: "Order not found." });
      const items = await sequelize.query(
        `SELECT oi."OrderItemId" AS id, oi."ProductName" AS "productName",
                oi."Quantity" AS quantity, oi."UnitPrice" AS "unitPrice",
                oi."DiscountAmount" AS "discountAmount", oi."TotalAmount" AS "totalAmount",
                s."StoreName" AS "storefrontName", cui."FullName" AS "creatorName",
                cui."Email" AS "creatorEmail"
         FROM "OrderItems" oi JOIN "Storefronts" s ON s."StorefrontId" = oi."StorefrontId"
         JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
         JOIN "UserAccounts" ua ON ua."UserId" = cp."UserId"
         JOIN "UserInfo" cui ON cui."UserInfoId" = ua."UserInfoId"
         WHERE oi."OrderId" = :orderId ORDER BY oi."OrderItemId"`,
        { replacements: { orderId: order.id }, type: QueryTypes.SELECT },
      );
      const payments = await sequelize.query(
        `SELECT "PaymentId" AS id, "PaymentMethod" AS provider,
                "TransactionId" AS "transactionId", "Amount" AS amount,
                "Currency" AS currency, "Status" AS status, "PaidAt" AS "paidAt",
                "CreatedAt" AS "createdAt", "UpdatedAt" AS "updatedAt"
         FROM "Payments" WHERE "OrderId" = :orderId ORDER BY "CreatedAt" DESC`,
        { replacements: { orderId: order.id }, type: QueryTypes.SELECT },
      );
      return res.json({ order, items, payments });
    } catch (error) {
      if (error instanceof Error && error.message.includes("reference")) return invalidRequest(res, error);
      return reportFailure(res, error, "load admin order details");
    }
  });

  router.get("/admin/payments", requireSuperAdmin, async (req, res) => {
    try {
      const pagination = getPagination(req.query);
      const conditions = ["TRUE"];
      const replacements: Record<string, string | number | Date> = {};
      if (req.query.status) {
        conditions.push('LOWER(p."Status"::text) = LOWER(:status)');
        replacements.status = String(req.query.status);
      }
      if (req.query.provider) {
        conditions.push('LOWER(p."PaymentMethod") = LOWER(:provider)');
        replacements.provider = String(req.query.provider);
      }
      if (req.query.search) {
        conditions.push(`(o."OrderNumber" ILIKE :search OR ui."FullName" ILIKE :search
          OR ui."Email" ILIKE :search OR COALESCE(p."TransactionId", '') ILIKE :search
          OR EXISTS (SELECT 1 FROM "OrderItems" oi JOIN "Storefronts" s ON s."StorefrontId" = oi."StorefrontId"
            JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
            JOIN "UserAccounts" cau ON cau."UserId" = cp."UserId"
            JOIN "UserInfo" cui ON cui."UserInfoId" = cau."UserInfoId"
            WHERE oi."OrderId" = o."OrderId" AND cui."FullName" ILIKE :search))`);
        replacements.search = `%${String(req.query.search).trim()}%`;
      }
      addDateFilters(req.query, conditions, replacements, 'p."CreatedAt"');
      const where = conditions.join(" AND ");
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*)::int AS total FROM "Payments" p
         JOIN "Orders" o ON o."OrderId" = p."OrderId"
         JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE ${where}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const payments = await sequelize.query(
        `SELECT p."PaymentId" AS id, o."OrderNumber" AS "orderNumber",
                ui."FullName" AS "buyerName", ui."Email" AS "buyerEmail",
                p."PaymentMethod" AS provider, p."TransactionId" AS "transactionId",
                p."Amount" AS amount, p."Currency" AS currency, p."Status" AS status,
                p."PaidAt" AS "paidAt", p."CreatedAt" AS "createdAt", p."UpdatedAt" AS "updatedAt"
         FROM "Payments" p JOIN "Orders" o ON o."OrderId" = p."OrderId"
         JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE ${where} ORDER BY p."CreatedAt" DESC, p."PaymentId" DESC
         LIMIT :pageSize OFFSET :offset`,
        { replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset }, type: QueryTypes.SELECT },
      );
      const summary = await sequelize.query(
        `SELECT "Status" AS status, COUNT(*)::int AS count, COALESCE(SUM("Amount"), 0) AS amount
         FROM "Payments" GROUP BY "Status" ORDER BY "Status"`,
        { type: QueryTypes.SELECT },
      );
      return res.json({ payments, summary, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: countRow.total, totalPages: Math.ceil(countRow.total / pagination.pageSize) } });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("date") || error.message.includes("page"))) return invalidRequest(res, error);
      return reportFailure(res, error, "load admin payment transactions");
    }
  });

  router.get("/admin/revenue", requireSuperAdmin, async (req, res) => {
    try {
      const orderConditions = [`o."Status" IN ('paid', 'completed')`];
      const orderReplacements: Record<string, string | number | Date> = {};
      addDateFilters(req.query, orderConditions, orderReplacements, 'o."CreatedAt"');
      const orderWhere = orderConditions.join(" AND ");
      const paymentConditions = ["TRUE"];
      const paymentReplacements: Record<string, string | number | Date> = {};
      addDateFilters(req.query, paymentConditions, paymentReplacements, 'p."CreatedAt"');
      const paymentWhere = paymentConditions.join(" AND ");
      const [summary] = await sequelize.query(
        `SELECT COUNT(DISTINCT o."OrderId")::int AS "successfulOrders",
                COALESCE(SUM(earning."SaleAmount"), 0) AS "grossRevenue",
                COALESCE(SUM(earning."MarketplaceCommission"), 0) AS "platformFees",
                COALESCE(SUM(earning."SaleAmount" - earning."MarketplaceCommission" -
                  COALESCE((SELECT SUM(adjustment."Amount")
                            FROM "CreatorEarningAdjustments" adjustment
                            WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"), 0)), 0) AS "creatorEarnings"
         FROM "Orders" o
         JOIN "CreatorEarnings" earning ON earning."OrderId" = o."OrderId"
         WHERE ${orderWhere}`,
        { replacements: orderReplacements, type: QueryTypes.SELECT },
      );
      const paymentStatuses = await sequelize.query(
        `SELECT p."Status" AS status, COUNT(*)::int AS count, COALESCE(SUM(p."Amount"), 0) AS amount
         FROM "Payments" p WHERE ${paymentWhere} GROUP BY p."Status" ORDER BY p."Status"`,
        { replacements: paymentReplacements, type: QueryTypes.SELECT },
      );
      const currencies = await sequelize.query(
        `SELECT earning."Currency" AS currency, COUNT(DISTINCT o."OrderId")::int AS orders,
                COALESCE(SUM(earning."SaleAmount"), 0) AS revenue,
                COALESCE(SUM(earning."MarketplaceCommission"), 0) AS "platformFees",
                COALESCE(SUM(earning."SaleAmount" - earning."MarketplaceCommission" -
                  COALESCE((SELECT SUM(adjustment."Amount")
                            FROM "CreatorEarningAdjustments" adjustment
                            WHERE adjustment."CreatorEarningId" = earning."CreatorEarningId"), 0)), 0) AS "creatorEarnings"
         FROM "Orders" o
         JOIN "CreatorEarnings" earning ON earning."OrderId" = o."OrderId"
         WHERE ${orderWhere}
         GROUP BY earning."Currency" ORDER BY earning."Currency"`,
        { replacements: orderReplacements, type: QueryTypes.SELECT },
      );
      return res.json({ summary, paymentStatuses, currencies });
    } catch (error) {
      if (error instanceof Error && error.message.includes("date")) return invalidRequest(res, error);
      return reportFailure(res, error, "load revenue report");
    }
  });

  router.get("/admin/refunds", requireSuperAdmin, async (req, res) => {
    try {
      const pagination = getPagination(req.query);
      const conditions = [`p."Status" IN ('refunded', 'partially_refunded')`];
      const replacements: Record<string, string | number | Date> = {};
      if (req.query.status) {
        conditions.push('LOWER(p."Status"::text) = LOWER(:status)');
        replacements.status = String(req.query.status);
      }
      if (req.query.search) {
        conditions.push(`(o."OrderNumber" ILIKE :search OR ui."FullName" ILIKE :search
          OR ui."Email" ILIKE :search OR COALESCE(p."TransactionId", '') ILIKE :search
          OR EXISTS (SELECT 1 FROM "OrderItems" oi JOIN "Storefronts" s ON s."StorefrontId" = oi."StorefrontId"
            JOIN "CreatorProfiles" cp ON cp."CreatorProfileId" = s."CreatorProfileId"
            JOIN "UserAccounts" cau ON cau."UserId" = cp."UserId"
            JOIN "UserInfo" cui ON cui."UserInfoId" = cau."UserInfoId"
            WHERE oi."OrderId" = o."OrderId" AND cui."FullName" ILIKE :search))`);
        replacements.search = `%${String(req.query.search).trim()}%`;
      }
      addDateFilters(req.query, conditions, replacements, 'p."UpdatedAt"');
      const where = conditions.join(" AND ");
      const [countRow] = await sequelize.query(
        `SELECT COUNT(*)::int AS total FROM "Payments" p
         JOIN "Orders" o ON o."OrderId" = p."OrderId"
         JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE ${where}`,
        { replacements, type: QueryTypes.SELECT },
      );
      const refunds = await sequelize.query(
        `SELECT p."PaymentId" AS id, o."OrderNumber" AS "orderNumber",
                ui."FullName" AS "buyerName", ui."Email" AS "buyerEmail",
                p."PaymentMethod" AS provider, p."TransactionId" AS "transactionId",
                p."Amount" AS amount, p."Currency" AS currency, p."Status" AS status,
                p."UpdatedAt" AS "updatedAt"
         FROM "Payments" p JOIN "Orders" o ON o."OrderId" = p."OrderId"
         JOIN "UserAccounts" ua ON ua."UserId" = o."UserId"
         JOIN "UserInfo" ui ON ui."UserInfoId" = ua."UserInfoId"
         WHERE ${where} ORDER BY p."UpdatedAt" DESC, p."PaymentId" DESC
         LIMIT :pageSize OFFSET :offset`,
        { replacements: { ...replacements, pageSize: pagination.pageSize, offset: pagination.offset }, type: QueryTypes.SELECT },
      );
      return res.json({ refunds, pagination: { page: pagination.page, pageSize: pagination.pageSize, total: countRow.total, totalPages: Math.ceil(countRow.total / pagination.pageSize) } });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("date") || error.message.includes("page"))) return invalidRequest(res, error);
      return reportFailure(res, error, "load refund monitoring records");
    }
  });

  return router;
};
