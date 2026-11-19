const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const storageDirectory = path.resolve(__dirname, "../uploads/products");

function getEncryptionKey() {
  const configuredKey = String(process.env.FILE_ENCRYPTION_KEY || process.env.JWT_SECRET || "").trim();
  if (!configuredKey) {
    throw new Error("FILE_ENCRYPTION_KEY or JWT_SECRET must be configured before encrypting product files.");
  }

  const normalizedKey = configuredKey.replace(/^0x/i, "");

  if (/^[a-f0-9]+$/i.test(normalizedKey)) {
    const keyHex = normalizedKey.length === 64 ? normalizedKey : crypto.createHash("sha256").update(normalizedKey, "utf8").digest("hex");
    return Buffer.from(keyHex, "hex");
  }

  return crypto.createHash("sha256").update(configuredKey, "utf8").digest();
}

async function saveProductFile(dataUrl, fileName, mimeType, storefrontKey = "default") {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Invalid product file data.");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw new Error("Product file data is empty.");
  const digest = crypto.createHash("sha256").update(`${String(storefrontKey)}:`).update(buffer).digest("hex");
  const storageKey = `${digest}.enc`;
  const filePath = path.join(storageDirectory, storageKey);
  await fs.mkdir(storageDirectory, { recursive: true, mode: 0o700 });
  await fs.chmod(storageDirectory, 0o700);
  try {
    await fs.access(filePath);
  } catch {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const envelope = JSON.stringify({
      version: 1,
      mimeType: String(mimeType || match[1] || "application/octet-stream"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    });
    try {
      await fs.writeFile(filePath, envelope, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  await fs.chmod(filePath, 0o600);
  return { fileName: String(fileName || storageKey).slice(0, 255), storageKey, fileSize: buffer.length, mimeType: String(mimeType || match[1] || "application/octet-stream") };
}

async function readProductFile(storageKey) {
  const key = String(storageKey || "");
  if (/^[a-f0-9]{64}\.enc$/i.test(key)) {
    const envelope = JSON.parse(await fs.readFile(path.join(storageDirectory, key), "utf8"));
    if (envelope.version !== 1 || !envelope.iv || !envelope.tag || !envelope.data) throw new Error("Invalid encrypted product file.");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return {
      buffer: Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]),
      mimeType: String(envelope.mimeType || "application/octet-stream"),
    };
  }
  if (/^[a-f0-9]{64}\.[a-z0-9]{1,12}$/i.test(key)) {
    return { buffer: await fs.readFile(path.join(storageDirectory, key)) };
  }
  throw new Error("Invalid product file storage key.");
}

async function deleteProductFile(storageKey) {
  const key = String(storageKey || "");
  if (!/^[a-f0-9]{64}\.(?:enc|[a-z0-9]{1,12})$/i.test(key)) {
    throw new Error("Invalid product file storage key.");
  }
  await fs.rm(path.join(storageDirectory, key), { force: true });
}

module.exports = { deleteProductFile, readProductFile, saveProductFile };
