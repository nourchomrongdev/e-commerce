const { QueryTypes } = require("sequelize");
const { sequelize, Product, ProductFile } = require("../models");
const { deleteProductFile } = require("./productFileService");

const RETENTION_DAYS = 30;
const BATCH_SIZE = 100;

async function findEligibleProducts() {
  return sequelize.query(
    `SELECT p."ProductId" AS "productId"
     FROM "Products" p
     JOIN LATERAL (
       SELECT e."NewStatus", e."CreatedAt"
       FROM "ProductApprovalEvents" e
       WHERE e."ProductId" = p."ProductId"
       ORDER BY e."CreatedAt" DESC, e."ProductApprovalEventId" DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE p."ApprovalStatus" = 'rejected'
       AND latest."NewStatus" = 'rejected'
       AND latest."CreatedAt" <= CURRENT_TIMESTAMP - (:retentionDays * INTERVAL '1 day')
       AND NOT EXISTS (SELECT 1 FROM "OrderItems" oi WHERE oi."ProductId" = p."ProductId")
       AND NOT EXISTS (SELECT 1 FROM "Licenses" l WHERE l."ProductId" = p."ProductId")
       AND NOT EXISTS (SELECT 1 FROM "CreatorEarnings" ce WHERE ce."ProductId" = p."ProductId")
     ORDER BY latest."CreatedAt" ASC
     LIMIT :batchSize`,
    {
      replacements: { retentionDays: RETENTION_DAYS, batchSize: BATCH_SIZE },
      type: QueryTypes.SELECT,
    },
  );
}

async function deleteIfStillEligible(productId) {
  return sequelize.transaction(async (transaction) => {
    const product = await Product.findByPk(productId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!product || String(product.ApprovalStatus).toLowerCase() !== "rejected") return null;

    const [latest] = await sequelize.query(
      `SELECT e."NewStatus" AS status, e."CreatedAt" AS "createdAt"
       FROM "ProductApprovalEvents" e
       WHERE e."ProductId" = :productId
       ORDER BY e."CreatedAt" DESC, e."ProductApprovalEventId" DESC
       LIMIT 1`,
      { replacements: { productId }, type: QueryTypes.SELECT, transaction },
    );
    if (!latest || latest.status !== "rejected") return null;
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (new Date(latest.createdAt).getTime() > cutoff) return null;

    const [history] = await sequelize.query(
      `SELECT
         EXISTS (SELECT 1 FROM "OrderItems" WHERE "ProductId" = :productId) AS "hasOrders",
         EXISTS (SELECT 1 FROM "Licenses" WHERE "ProductId" = :productId) AS "hasLicenses",
         EXISTS (SELECT 1 FROM "CreatorEarnings" WHERE "ProductId" = :productId) AS "hasEarnings"`,
      { replacements: { productId }, type: QueryTypes.SELECT, transaction },
    );
    if (history.hasOrders || history.hasLicenses || history.hasEarnings) return null;

    const files = await ProductFile.findAll({
      where: { ProductId: productId },
      attributes: ["StorageKey"],
      raw: true,
      transaction,
    });
    await product.destroy({ transaction });
    return [...new Set(files.map((file) => file.StorageKey).filter(Boolean))];
  });
}

async function cleanupRejectedProducts() {
  const candidates = await findEligibleProducts();
  let deletedProducts = 0;
  let skippedProducts = 0;
  const storageKeys = new Set();

  for (const { productId } of candidates) {
    try {
      const deletedKeys = await deleteIfStillEligible(productId);
      if (!deletedKeys) {
        skippedProducts += 1;
        continue;
      }
      deletedProducts += 1;
      for (const key of deletedKeys) storageKeys.add(key);
    } catch (error) {
      skippedProducts += 1;
      console.error(`Rejected product cleanup failed for product ${productId}.`, error);
    }
  }

  for (const storageKey of storageKeys) {
    try {
      const referenceCount = await ProductFile.count({ where: { StorageKey: storageKey } });
      if (referenceCount === 0) await deleteProductFile(storageKey);
    } catch (error) {
      console.error("Rejected product file cleanup failed.", error);
    }
  }

  return { deletedProducts, skippedProducts };
}

module.exports = { cleanupRejectedProducts };
