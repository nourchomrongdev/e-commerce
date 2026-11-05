const express = require("express");
const adminAccessController = require("../controllers/adminAccessController");

module.exports = function createAdminRoutes({ requireAdmin, requireSuperAdmin }) {
  const router = express.Router();

  router.get("/admin/session", requireAdmin, (req, res) => {
    const { toUser } = require("../controllers/authHelpers");
    return res.json({ user: toUser(req.user) });
  });
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
