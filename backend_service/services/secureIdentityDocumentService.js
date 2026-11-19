const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const storageDirectory = path.resolve(__dirname, "../uploads/private-identity");
const supportedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function getEncryptionKey() {
  const configuredKey = String(process.env.FILE_ENCRYPTION_KEY || process.env.JWT_SECRET || "").trim();
  if (!configuredKey) throw new Error("FILE_ENCRYPTION_KEY or JWT_SECRET must be configured for identity document encryption.");
  return crypto.createHash("sha256").update(configuredKey, "utf8").digest();
}

function hasExpectedSignature(buffer, mimeType) {
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

async function saveIdentityDocument(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
    throw new Error("Identity documents must be between 1 byte and 10 MB.");
  }
  const normalizedMimeType = String(mimeType || "").toLowerCase().split(";")[0].trim();
  if (!supportedMimeTypes.has(normalizedMimeType) || !hasExpectedSignature(buffer, normalizedMimeType)) {
    throw new Error("Upload a valid PDF, JPEG, PNG, or WebP identity document.");
  }

  const storageKey = `${crypto.randomUUID()}.enc`;
  const filePath = path.join(storageDirectory, storageKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const envelope = JSON.stringify({
    version: 1,
    mimeType: normalizedMimeType,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });

  await fs.mkdir(storageDirectory, { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, envelope, { flag: "wx", mode: 0o600 });
  return { storageKey, mimeType: normalizedMimeType, size: buffer.length };
}

async function readIdentityDocument(storageKey) {
  const key = String(storageKey || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.enc$/i.test(key)) {
    throw new Error("Invalid identity document storage key.");
  }

  const envelope = JSON.parse(await fs.readFile(path.join(storageDirectory, key), "utf8"));
  if (envelope.version !== 1 || !envelope.iv || !envelope.tag || !envelope.data) {
    throw new Error("Invalid encrypted identity document.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return {
    buffer: Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]),
    mimeType: String(envelope.mimeType || "application/octet-stream"),
  };
}

async function deleteIdentityDocument(storageKey) {
  const key = String(storageKey || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.enc$/i.test(key)) {
    throw new Error("Invalid identity document storage key.");
  }
  await fs.unlink(path.join(storageDirectory, key));
}

module.exports = { deleteIdentityDocument, readIdentityDocument, saveIdentityDocument };
