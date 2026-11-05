const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const fs = require("fs/promises");
const path = require("path");
const { sequelize, UserAccount, UserRole, UserAccountRole, CreatorProfile, Storefront, CreatorPayoutInfo, CardInfo, Product, ProductFile, ProductPreview, ProductVersion, Order, OrderItem, LegalPolicy, LegalPolicyVersion, LegalPolicyAuditLog } = require("../models");
const authRoutes = require("./authRoutes");
const { createPaymentOrder, capturePaymentOrder } = require("../controllers/paymentController");
const policyRoutes = require("./policyRoutes");
const requireCreatorRoutes = require("./creatorRoutes");
const createProductRoutes = require("./productRoutes");
const createAdminRoutes = require("./adminRoutes");
const createMarketplaceRoutes = require("./marketplaceRoutes");
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
    const isVerified = Boolean(verifiedUser.creatorProfile?.IsVerified);
    let roleLinks = await UserAccountRole.findAll({
      where: { UserId: verifiedUser.UserId },
      include: [{ model: UserRole, as: "role" }],
    });
    const hasCreatorRole = roleLinks.some((link) => String(link.role?.RoleName || "").toLowerCase() === "creator");

    if (isVerified && role !== "creator" && !hasCreatorRole) {
      const creatorRole = await UserRole.findOrCreate({
        where: { RoleName: "Creator" },
        defaults: { RoleName: "Creator" },
      });
      await UserAccountRole.findOrCreate({
        where: { UserId: verifiedUser.UserId, UserRoleId: creatorRole[0].UserRoleId },
        defaults: { UserId: verifiedUser.UserId, UserRoleId: creatorRole[0].UserRoleId, CreatedAt: new Date() },
      });
      roleLinks = [...roleLinks, { role: creatorRole[0] }];
      role = "creator";
    }

    const hasCreatorAccess = role === "creator" || roleLinks.some((link) => String(link.role?.RoleName || "").toLowerCase() === "creator");
    if (!hasCreatorAccess || !isVerified) {
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

type LegacyStorefront = {
  id: number;
  displayName: string;
  slug: string;
  type: string;
  products: number;
  revenue: string;
  description: string;
  theme?: string;
  isPublished?: boolean;
  isFeatured?: boolean;
  guestPurchase?: boolean;
  logoUrl?: string;
};

const products = [
  { id: 1, name: "Website Template", price: 15, category: "Templates" },
  { id: 2, name: "E-Book", price: 10, category: "Books" },
];

let storefronts: LegacyStorefront[] = [
  {
    id: 1,
    displayName: "TestStore",
    slug: "teststore",
    type: "Templates",
    products: 24,
    revenue: "$1,284.00",
    description: "Professional templates and design resources for modern websites",
  },
  {
    id: 2,
    displayName: "DevCourses",
    slug: "devcourses",
    type: "Digital Products",
    products: 12,
    revenue: "$2,450.00",
    description: "Online courses and resources for developers to level up their skills",
  },
  {
    id: 3,
    displayName: "AI Resources",
    slug: "ai-resources",
    type: "Bundles",
    products: 7,
    revenue: "$920.00",
    description: "AI tools and learning bundles for everyone",
  },
  {
    id: 4,
    displayName: "DesignHub",
    slug: "designhub",
    type: "UI Kits",
    products: 18,
    revenue: "$1,860.00",
    description: "Beautiful UI kits and design systems",
  },
];

// Storefronts are created through the API; keep runtime state empty on startup.
storefronts = [];

const storefrontState = new Map<string, { branding: Record<string, unknown>; settings: Record<string, unknown> }>(
  storefronts.map((storefront) => [storefront.displayName, {
    branding: {
      storeName: storefront.displayName,
      description: storefront.description,
      accentColor: "#5b6ef5",
      bannerEnabled: true,
      bannerImage: "",
    },
    settings: {
      email: "devcourses@gmail.com",
      phone: "+855 12 345 678",
      country: "Cambodia",
      timezone: "(GMT+07:00) Indochina Time (ICT)",
      language: "English",
      automaticStorefront: false,
      socialLinks: {},
    },
  }]),
);

function findStorefront(name, res) {
  const storefrontName = decodeURIComponent(name);
  const storefront = storefronts.find((item) => item.displayName === storefrontName);

  if (!storefront) {
    res.status(404).json({ error: "Storefront not found" });
    return null;
  }

  return { storefrontName, storefront };
}

function hasLogoReference(imageUrl: string, ignoredStorefront?: LegacyStorefront) {
  return storefronts.some((storefront) => storefront !== ignoredStorefront && storefront.logoUrl === imageUrl);
}

function mediaUrl(req, imageUrl) {
  return imageUrl.startsWith("/") ? `${req.protocol}://${req.get("host")}${imageUrl}` : imageUrl;
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

router.use(createMarketplaceRoutes({ requireUser, requireAdmin, products, storefronts }));
router.use(createProductRoutes({ requireAdmin }));
router.use(createAdminRoutes({ requireAdmin, requireSuperAdmin }));
router.use("/auth", authRoutes);
router.use("/admin/policies", policyRoutes);

router.use("/creator", requireCreatorAccess);
router.use(requireCreatorRoutes);

module.exports = router;
