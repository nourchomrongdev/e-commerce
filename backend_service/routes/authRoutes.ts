const express = require("express");
const { adminLogin, login } = require("../controllers/loginController");
const { register } = require("../controllers/registerController");
const { googleStart, googleCallback, paypalStart, paypalCallback } = require("../controllers/oauthController");
const { me, updateProfile, requestEmailVerification, verifyEmail, requestRecoveryEmailVerification, verifyRecoveryEmail, forgotPassword, resetPassword } = require("../controllers/userController");

const router = express.Router();

router.post("/login", login);
router.post("/admin-login", adminLogin);
router.post("/register", register);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", me);
router.patch("/profile", updateProfile);
router.post("/email-verification/request", requestEmailVerification);
router.post("/email-verification/verify", verifyEmail);
router.post("/recovery-email/request", requestRecoveryEmailVerification);
router.post("/recovery-email/verify", verifyRecoveryEmail);
router.get("/google", googleStart);
router.get("/google/callback", googleCallback);
router.get("/paypal", paypalStart);
router.get("/paypal/callback", paypalCallback);

module.exports = router;
