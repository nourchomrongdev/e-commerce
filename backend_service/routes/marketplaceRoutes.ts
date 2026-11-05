const express = require("express");
const { readEncryptedImage } = require("../services/encryptedImageService");
const { applyCreatorProgram, approveCreatorProfile } = require("../controllers/creatorProgramController");
const { createPaymentOrder, capturePaymentOrder } = require("../controllers/paymentController");

module.exports = function createMarketplaceRoutes({ requireUser, requireAdmin, products, storefronts }) {
  const router = express.Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok", service: "marketplace-api" });
  });

  router.get("/marketplace", (req, res) => {
    res.json({ products, storefronts });
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
