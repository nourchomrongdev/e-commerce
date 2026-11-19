const crypto = require("crypto");

function getEncryptionKey() {
  const secret = process.env.PAYMENT_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET or PAYMENT_TOKEN_ENCRYPTION_KEY is required to store PayPal vault tokens.");
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptPayPalVaultToken(token) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) throw new Error("A PayPal vault token is required.");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalizedToken, "utf8"), cipher.final()]);

  return {
    encryptedToken: JSON.stringify({
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    }),
    fingerprint: crypto.createHash("sha256").update(normalizedToken).digest("hex"),
  };
}

function decryptPayPalVaultToken(encryptedToken) {
  const payload = JSON.parse(String(encryptedToken || ""));
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

module.exports = { encryptPayPalVaultToken, decryptPayPalVaultToken };
