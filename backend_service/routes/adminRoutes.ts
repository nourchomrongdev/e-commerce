const express = require("express");
const adminAccessController = require("../controllers/adminAccessController");
const adminDataController = require("../controllers/adminDataController");
const { sequelize } = require("../models");
const { QueryTypes } = require("sequelize");

module.exports = function createAdminRoutes({ requireAdmin, requireSuperAdmin }) {
  const router = express.Router();

  router.get("/admin/session", requireAdmin, (req, res) => {
    const { toUser } = require("../controllers/authHelpers");
    return res.json({ user: toUser(req.user) });
  });
  router.get("/admin/settings/storefront-limit", requireAdmin, async (req, res) => {
    try {
      const [settings] = await sequelize.query(
        `SELECT "MaximumStorefrontsPerCreator" AS "maximumStorefrontsPerCreator"
         FROM "MarketplaceConfigurationSettings" WHERE "SettingsId" = 1`,
        { type: QueryTypes.SELECT },
      );
      if (!settings) throw new Error("Storefront limit settings are unavailable.");
      return res.json({ settings });
    } catch (error) {
      console.error("Storefront limit settings load failed", error);
      return res.status(500).json({ error: "Unable to load storefront limit settings." });
    }
  });
  router.put("/admin/settings/storefront-limit", requireAdmin, async (req, res) => {
    const maximumStorefrontsPerCreator = Number(req.body.maximumStorefrontsPerCreator);
    if (!Number.isInteger(maximumStorefrontsPerCreator) || maximumStorefrontsPerCreator < 1 || maximumStorefrontsPerCreator > 50) {
      return res.status(400).json({ error: "The storefront limit must be a whole number between 1 and 50." });
    }
    try {
      await sequelize.query(
        `INSERT INTO "MarketplaceConfigurationSettings"
           ("SettingsId", "MaximumStorefrontsPerCreator", "UpdatedAt")
         VALUES (1, :maximumStorefrontsPerCreator, CURRENT_TIMESTAMP)
         ON CONFLICT ("SettingsId") DO UPDATE SET
           "MaximumStorefrontsPerCreator" = EXCLUDED."MaximumStorefrontsPerCreator",
           "UpdatedAt" = CURRENT_TIMESTAMP`,
        { replacements: { maximumStorefrontsPerCreator } },
      );
      return res.json({ message: "Storefront limit saved.", settings: { maximumStorefrontsPerCreator } });
    } catch (error) {
      console.error("Storefront limit settings save failed", error);
      return res.status(500).json({ error: "Unable to save storefront limit settings." });
    }
  });
  router.get("/admin/dashboard", requireAdmin, adminDataController.getDashboard);
  router.get("/admin/activity/export.csv", requireAdmin, adminDataController.exportActivity);
  router.get("/admin/activity", requireAdmin, adminDataController.listActivity);
  router.get("/admin/activity/:activityId", requireAdmin, adminDataController.getActivity);
  router.get("/admin/data/:resource", requireAdmin, adminDataController.listResource);
  router.get("/admin/users", requireAdmin, adminAccessController.listUsers);
  router.post("/admin/users", requireSuperAdmin, adminAccessController.createUser);
  router.patch("/admin/users/:userId", requireAdmin, adminAccessController.updateUser);
  router.delete("/admin/users/:userId", requireSuperAdmin, adminAccessController.deleteUser);
  router.get("/admin/roles", requireAdmin, adminAccessController.listRoles);
  router.post("/admin/roles", requireSuperAdmin, adminAccessController.createRole);
  router.patch("/admin/roles/:roleId", requireSuperAdmin, adminAccessController.updateRole);
  router.delete("/admin/roles/:roleId", requireSuperAdmin, adminAccessController.deleteRole);

  return router;
};
