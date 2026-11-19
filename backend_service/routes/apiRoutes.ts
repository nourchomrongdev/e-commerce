const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const fs = require("fs/promises");
const path = require("path");
const { sequelize, UserAccount, UserRole, UserAccountRole, CreatorProfile, Storefront, CreatorPayoutInfo, CardInfo, Product, ProductFile, ProductPreview, ProductVersion, Order, OrderItem, LegalPolicy, LegalPolicyVersion, LegalPolicyAuditLog } = require("../models");
const authRoutes = require("./authRoutes");
const { createPaymentOrder, getPaymentProviderStatus, capturePaymentOrder, getSavedPayPalCards, createSavedCardSetupToken, confirmSavedCardSetup, setDefaultPayPalCard, deleteSavedPayPalCard, createABAPayWayOrder, getABAPayWayPaymentStatus, captureABAPayWayOrder, createCheckoutOrder, getPurchaseEligibility, createFreeProductOrder, retryPaymentOrder } = require("../controllers/paymentController");
const policyRoutes = require("./policyRoutes");
const requireCreatorRoutes = require("./creatorRoutes");
const createProductRoutes = require("./productRoutes");
const createAdminRoutes = require("./adminRoutes");
const createMarketplaceRoutes = require("./marketplaceRoutes");
const createLicenseRoutes = require("./licenseRoutes");
const createDMCARoutes = require("./dmcaRoutes");
const createCommerceRoutes = require("./commerceRoutes");
const createFinanceRoutes = require("./financeRoutes");
const createNotificationRoutes = require("./notificationRoutes");
const { applyCreatorProgram, approveCreatorProfile } = require("../controllers/creatorProgramController");
const { ensureCreatorRoleForUser, findByToken, toUser } = require("../controllers/authHelpers");
const { deleteEncryptedImage, readEncryptedImage, saveEncryptedImage } = require("../services/encryptedImageService");
const { saveProductFile } = require("../services/productFileService");
const { setupPaymentToken } = require("../services/paypalService");
const { sendSecurityEmail } = require("../services/mailService");
const adminAccessController = require("../controllers/adminAccessController");

const router = express.Router();
const MARKETPLACE_FEE_RATE = 0.2;
const encryptionKey = crypto.createHash("sha256").update(process.env.JWT_SECRET || "local-development-secret-change-me").digest();

function encryptSensitiveValue(value) {
  if (value === null || value === undefined) return "";
  const normalized = String(value);
  if (!normalized.trim()) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(normalized, "utf8")), cipher.final()]);

  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}

function decryptSensitiveValue(value) {
  if (typeof value !== "string" || !value.trim()) return value;

  try {
    const parsed = JSON.parse(value);
    if (parsed && parsed.iv && parsed.tag && parsed.data) {
      const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(parsed.iv, "base64"));
      decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]);
      return decrypted.toString("utf8");
    }
  } catch {
    return value;
  }

  return value;
}

function maskLicenseKey(value) {
  const key = String(value || "");
  return key.length > 8 ? `${key.slice(0, 4)}****${key.slice(-4)}` : "********";
}

function isValidCardNumber(cardNumber) {
  const digits = String(cardNumber || "").replace(/\D/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

async function requireUser(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });

  try {
    const user = await findByToken(token);
    if (!user) return res.status(401).json({ error: "User account is unavailable." });
    req.userId = user.UserId;
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

async function requireCreatorAccess(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });

  try {
    const user = await findByToken(token);
    if (!user) return res.status(401).json({ error: "User account is unavailable." });

    const verifiedUser = await ensureCreatorRoleForUser(user);
    let role = String(verifiedUser.role?.RoleName || verifiedUser.RoleName || "").toLowerCase();
    const isApprovedCreator = verifiedUser.creatorProfile?.AccountApprovalStatus === "approved" && verifiedUser.creatorProfile?.IsActive === true;
    const roleLinks = await UserAccountRole.findAll({
      where: { UserId: verifiedUser.UserId },
      include: [{ model: UserRole, as: "role" }],
    });
    const hasCreatorRole = roleLinks.some((link) => String(link.role?.RoleName || "").toLowerCase() === "creator");
    const hasCreatorAccess = role === "creator" || roleLinks.some((link) => String(link.role?.RoleName || "").toLowerCase() === "creator");
    if (!hasCreatorAccess || !isApprovedCreator) {
      return res.status(403).json({ error: "Creator access requires an approved creator profile." });
    }

    req.userId = user.UserId;
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

async function requireAdmin(req, res, next) {
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

async function requireSuperAdmin(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });

  try {
    const user = await findByToken(token);
    if (!user) return res.status(401).json({ error: "User account is unavailable." });

    const roleNames = [user.role?.RoleName || user.RoleName, ...(user.roles || []).map((link) => link.role?.RoleName || link.RoleName)]
      .filter(Boolean)
      .map((role) => String(role).toLowerCase());
    if (!roleNames.includes("superadmin")) {
      return res.status(403).json({ error: "Superadmin access required." });
    }

    req.userId = user.UserId;
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

async function requireReviewModerator(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });

  try {
    const user = await findByToken(token);
    if (!user) return res.status(401).json({ error: "User account is unavailable." });
    const roleNames = [user.role?.RoleName || user.RoleName, ...(user.roles || []).map((link) => link.role?.RoleName || link.RoleName)]
      .filter(Boolean)
      .map((role) => String(role).toLowerCase());
    if (!roleNames.some((role) => ["admin", "superadmin", "reviewer"].includes(role))) {
      return res.status(403).json({ error: "Review moderator access required." });
    }

    req.userId = user.UserId;
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

function capitalizeFirstCharacter(value) {
  const text = String(value || "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

function slugifyStorefrontName(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getUpdatedStorefrontNameAndSlug(storefront, body) {
  const storeName = String(body.storeName ?? storefront.StoreName).trim();
  const nameChanged = body.storeName !== undefined && storeName.toLowerCase() !== String(storefront.StoreName).toLowerCase();
  const storeSlug = nameChanged
    ? slugifyStorefrontName(storeName)
    : body.slug === undefined
      ? storefront.StoreSlug
      : String(body.slug).trim().toLowerCase();
  return { storeName, storeSlug };
}

function serializeProduct(product) {
  return {
    id: product.ProductId,
    uuid: product.UUID,
    name: capitalizeFirstCharacter(product.ProductName),
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

function parseDiscount(body, price, fallback: { type?: string; amount?: number } = {}) {
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

router.use(createNotificationRoutes({ requireUser }));
router.use(createMarketplaceRoutes({ requireUser, requireAdmin }));
router.use(createProductRoutes({ requireAdmin }));
router.use(createAdminRoutes({ requireAdmin, requireSuperAdmin }));
router.use(createLicenseRoutes({ requireUser, requireAdmin }));
router.use(createDMCARoutes({ requireUser, findByToken }));
router.use(createCommerceRoutes({ requireUser, requireCreatorAccess, requireAdmin, requireReviewModerator, requireSuperAdmin }));
router.post("/payments/paypal/order", createPaymentOrder);
router.get("/payments/providers/status", getPaymentProviderStatus);
router.post("/payments/paypal/capture", capturePaymentOrder);
router.get("/payments/paypal/saved-cards", getSavedPayPalCards);
router.post("/payments/paypal/saved-cards/setup-token", createSavedCardSetupToken);
router.post("/payments/paypal/saved-cards/confirm", confirmSavedCardSetup);
router.patch("/payments/paypal/saved-cards/:cardId/default", setDefaultPayPalCard);
router.delete("/payments/paypal/saved-cards/:cardId", deleteSavedPayPalCard);
router.post("/payments/payway/order", createABAPayWayOrder);
router.get("/payments/payway/status/:paymentReference", getABAPayWayPaymentStatus);
router.post("/payments/payway/capture", captureABAPayWayOrder);
router.post("/payments/abayapayway/order", createABAPayWayOrder);
router.get("/payments/abayapayway/status/:paymentReference", getABAPayWayPaymentStatus);
router.post("/payments/abayapayway/capture", captureABAPayWayOrder);
router.post("/payment/retry", retryPaymentOrder);
router.post("/orders/checkout", createCheckoutOrder);
router.get("/orders/purchase-eligibility/:productId", getPurchaseEligibility);
router.post("/orders/free", createFreeProductOrder);
router.use(createFinanceRoutes({ requireCreatorAccess, requireAdmin, requireSuperAdmin }));
router.use("/auth", authRoutes);
router.use("/admin/policies", policyRoutes);
router.use("/policies", policyRoutes);

router.use("/creator", requireCreatorAccess);
router.use(requireCreatorRoutes);

module.exports = router;
