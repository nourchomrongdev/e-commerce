const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { sequelize, UserInfo, UserAccount } = require("../models");
const { findByToken, requireDatabase, restrictionForToken, toUser } = require("./authHelpers");
const { sendSecurityEmail } = require("../services/mailService");
const { deleteEncryptedImage, isStoredImageUrl, saveEncryptedImage } = require("../services/encryptedImageService");

const otpLength = Math.max(4, Math.min(8, Number(process.env.PASSWORD_RESET_OTP_LENGTH || 6)));
const otpExpiryMinutes = Math.max(1, Number(process.env.PASSWORD_RESET_OTP_EXPIRES_MINUTES || 15));
const verificationOtpExpiryMinutes = 15;
const verificationResendDelayMs = 60 * 1000;

function maskEmail(email) {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "your email address";
  const visibleCharacters = localPart.length > 2 ? 1 : 0;
  return `${localPart.slice(0, visibleCharacters)}${"*".repeat(Math.max(3, localPart.length - visibleCharacters))}${localPart.slice(-2)}@${domain}`;
}

async function me(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    const restriction = await restrictionForToken(token);
    if (restriction) {
      return res.status(403).json({
        error: restriction.status === "banned" ? "Your account has been banned." : "Your account has been disabled.",
        code: restriction.status === "banned" ? "ACCOUNT_BANNED" : "ACCOUNT_SUSPENDED",
        message: restriction.message,
        name: restriction.name,
        username: restriction.username,
        email: restriction.email,
        startsAt: restriction.startsAt,
        suspendedUntil: restriction.endsAt,
      });
    }
    const user = await findByToken(token);
    if (!user) return res.status(401).json({ error: "User account is unavailable." });
    return res.json({ user: toUser(user) });
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

async function updateProfile(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });

  const body = req.body || {};
  const supplied = ["name", "username", "phone", "avatarUrl", "bio", "location"].filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (!supplied.length) return res.status(400).json({ error: "Provide at least one profile field to update." });

  const updates: { name?: string; username?: string; phone?: string | null; avatarUrl?: string | null; bio?: string | null; location?: string | null } = {};
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 255) return res.status(400).json({ error: "Name must be between 1 and 255 characters." });
    updates.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(body, "username")) {
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return res.status(400).json({ error: "Username must be 3-30 characters using only letters, numbers, and underscores." });
    }
    updates.username = username;
  }
  if (Object.prototype.hasOwnProperty.call(body, "phone")) {
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (phone.length > 50 || (phone && !/^[+()\d.\-\s]+$/.test(phone))) {
      return res.status(400).json({ error: "Enter a valid phone number of up to 50 characters." });
    }
    updates.phone = phone || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "bio")) {
    const bio = typeof body.bio === "string" ? body.bio.trim() : "";
    if (bio.length > 500) return res.status(400).json({ error: "Bio must be 500 characters or fewer." });
    updates.bio = bio || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "location")) {
    const location = typeof body.location === "string" ? body.location.trim() : "";
    if (location.length > 100) return res.status(400).json({ error: "Location must be 100 characters or fewer." });
    updates.location = location || null;
  }

  let user;
  try {
    user = await findByToken(token);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
  if (!user) return res.status(401).json({ error: "User account is unavailable." });

  const currentAvatarUrl = user.info?.AvatarUrl || null;
  let newAvatarUrl: string | null = null;
  if (Object.prototype.hasOwnProperty.call(body, "avatarUrl")) {
    if (typeof body.avatarUrl !== "string" || body.avatarUrl.length > 2_800_000) {
      return res.status(400).json({ error: "Choose an image no larger than 2 MB." });
    }
    const avatar = body.avatarUrl.trim();
    if (!avatar) {
      updates.avatarUrl = null;
    } else if (avatar === currentAvatarUrl) {
      updates.avatarUrl = currentAvatarUrl;
    } else if (isStoredImageUrl(avatar)) {
      return res.status(400).json({ error: "You can only keep your current profile photo or upload a new one." });
    } else {
      const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(avatar);
      if (!match) return res.status(400).json({ error: "Profile photo must be a PNG, JPG, or WEBP image." });
      const image = Buffer.from(match[1], "base64");
      if (!image.length || image.length > 2 * 1024 * 1024) {
        return res.status(400).json({ error: "Profile photo must be no larger than 2 MB." });
      }
      const imageType = avatar.slice(5, avatar.indexOf(";"));
      const validSignature = imageType === "image/png"
        ? image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
        : imageType === "image/jpeg"
          ? image.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))
          : image.length >= 12 && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP";
      if (!validSignature) return res.status(400).json({ error: "The selected file is not a valid PNG, JPG, or WEBP image." });
      try {
        newAvatarUrl = await saveEncryptedImage(avatar, `user-${user.UserId}`);
        updates.avatarUrl = newAvatarUrl;
      } catch (error) {
        console.error("Profile photo could not be stored", error);
        return res.status(500).json({ error: "Unable to save your profile photo." });
      }
    }
  }

  let profileSaved = false;
  try {
    await sequelize.transaction(async (transaction) => {
      if (updates.username !== undefined) {
        const [existing] = await sequelize.query(
          `SELECT "UserId" FROM "UserAccounts"
           WHERE LOWER("Username") = LOWER(:username) AND "UserId" <> :userId
           LIMIT 1`,
          { replacements: { username: updates.username, userId: user.UserId }, transaction },
        );
        if (existing.length > 0) {
          const error = new Error("That username is already taken.");
          error.name = "UsernameConflictError";
          throw error;
        }
        await UserAccount.update(
          { Username: updates.username },
          { where: { UserId: user.UserId }, transaction },
        );
      }

      const infoUpdates: { FullName?: string; Phone?: string | null; AvatarUrl?: string | null; Bio?: string | null; Location?: string | null } = {};
      if (updates.name !== undefined) infoUpdates.FullName = updates.name;
      if (updates.phone !== undefined) infoUpdates.Phone = updates.phone;
      if (updates.avatarUrl !== undefined) infoUpdates.AvatarUrl = updates.avatarUrl;
      if (updates.bio !== undefined) infoUpdates.Bio = updates.bio;
      if (updates.location !== undefined) infoUpdates.Location = updates.location;
      if (Object.keys(infoUpdates).length) {
        await UserInfo.update(infoUpdates, { where: { UserInfoId: user.UserInfoId }, transaction });
      }
    });
    profileSaved = true;

    const updatedUser = await findByToken(token);
    if (!updatedUser) return res.status(401).json({ error: "User account is unavailable." });
    if (updates.avatarUrl !== undefined && currentAvatarUrl && currentAvatarUrl !== updates.avatarUrl) {
      try {
        await deleteEncryptedImage(currentAvatarUrl);
      } catch (cleanupError) {
        console.error("Previous profile photo could not be removed", cleanupError);
      }
    }
    return res.json({ user: toUser(updatedUser) });
  } catch (error) {
    if (newAvatarUrl && !profileSaved) {
      try {
        await deleteEncryptedImage(newAvatarUrl);
      } catch (cleanupError) {
        console.error("Uncommitted profile photo could not be removed", cleanupError);
      }
    }
    if (error.name === "UsernameConflictError" || error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ error: "That username is already taken." });
    }
    console.error("Profile update failed", error);
    return res.status(500).json({ error: "Unable to update your profile." });
  }
}

async function requestEmailVerification(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });

  try {
    const user = await findByToken(token);
    if (!user) return res.status(401).json({ error: "User account is unavailable." });
    if (user.EmailVerifiedAt) return res.status(409).json({ error: "Your email address is already verified." });
    const requestedAt = user.EmailVerificationOtpRequestedAt ? new Date(user.EmailVerificationOtpRequestedAt).getTime() : 0;
    const remainingDelay = verificationResendDelayMs - (Date.now() - requestedAt);
    if (remainingDelay > 0) {
      return res.status(429).json({ error: "Please wait before requesting another verification code.", retryAfterSeconds: Math.ceil(remainingDelay / 1000) });
    }

    const email = String(user.info?.Email || "");
    if (!email) return res.status(400).json({ error: "Your account does not have an email address." });
    const code = String(crypto.randomInt(0, 10 ** 6)).padStart(6, "0");
    user.EmailVerificationOtpHash = crypto.createHash("sha256").update(code).digest("hex");
    user.EmailVerificationOtpExpiresAt = new Date(Date.now() + verificationOtpExpiryMinutes * 60 * 1000);
    user.EmailVerificationOtpRequestedAt = new Date();
    user.EmailVerificationAttempts = 0;
    await user.save();

    const sent = await sendSecurityEmail({
      to: email,
      subject: "Verify your KhmerDigital email address",
      text: `Your KhmerDigital email verification code is ${code}. It expires in ${verificationOtpExpiryMinutes} minutes.`,
    });
    if (!sent) {
      user.EmailVerificationOtpHash = null;
      user.EmailVerificationOtpExpiresAt = null;
      user.EmailVerificationOtpRequestedAt = null;
      user.EmailVerificationAttempts = 0;
      await user.save();
      return res.status(503).json({ error: "Verification email could not be sent. Please try again later." });
    }

    return res.json({ message: "A verification code has been sent to your email address.", maskedEmail: maskEmail(email) });
  } catch (error) {
    if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid or expired session." });
    }
    console.error("Email verification code could not be sent", error);
    return res.status(500).json({ error: "Unable to send an email verification code." });
  }
}

async function verifyEmail(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });
  const code = String(req.body?.code || "").trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the 6-digit verification code." });

  let user;
  try {
    user = await findByToken(token);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
  if (!user) return res.status(401).json({ error: "User account is unavailable." });
  if (user.EmailVerifiedAt) return res.json({ user: toUser(user), message: "Your email address is already verified." });

  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  try {
    const accepted = await sequelize.transaction(async (transaction) => {
      const account = await UserAccount.findByPk(user.UserId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!account) return false;
      if (account.EmailVerifiedAt) return true;
      if (!account.EmailVerificationOtpHash || !account.EmailVerificationOtpExpiresAt || new Date(account.EmailVerificationOtpExpiresAt).getTime() <= Date.now()) return false;
      if (Number(account.EmailVerificationAttempts || 0) >= 5) {
        account.EmailVerificationOtpHash = null;
        account.EmailVerificationOtpExpiresAt = null;
        await account.save({ transaction });
        return false;
      }
      if (account.EmailVerificationOtpHash !== codeHash) {
        account.EmailVerificationAttempts = Number(account.EmailVerificationAttempts || 0) + 1;
        if (account.EmailVerificationAttempts >= 5) {
          account.EmailVerificationOtpHash = null;
          account.EmailVerificationOtpExpiresAt = null;
        }
        await account.save({ transaction });
        return false;
      }
      account.EmailVerifiedAt = new Date();
      account.EmailVerificationOtpHash = null;
      account.EmailVerificationOtpExpiresAt = null;
      account.EmailVerificationOtpRequestedAt = null;
      account.EmailVerificationAttempts = 0;
      await account.save({ transaction });
      return true;
    });
    if (!accepted) return res.status(400).json({ error: "This verification code is invalid, expired, or has reached the attempt limit." });
    const updatedUser = await findByToken(token);
    return res.json({ user: toUser(updatedUser), message: "Your email address has been verified." });
  } catch (error) {
    console.error("Email verification failed", error);
    return res.status(500).json({ error: "Unable to verify your email address." });
  }
}

async function requestRecoveryEmailVerification(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });

  const email = String(req.body?.email || "").trim().toLowerCase();
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid recovery email address." });
  }

  try {
    const user = await findByToken(token);
    if (!user) return res.status(401).json({ error: "User account is unavailable." });
    const primaryEmail = String(user.info?.Email || "").trim().toLowerCase();
    if (email === primaryEmail) {
      return res.status(400).json({ error: "Recovery email must be different from your primary email." });
    }
    if (String(user.RecoveryEmail || "").toLowerCase() === email && user.RecoveryEmailVerifiedAt) {
      return res.status(409).json({ error: "This recovery email is already verified." });
    }

    const requestedAt = user.RecoveryEmailVerificationOtpRequestedAt
      ? new Date(user.RecoveryEmailVerificationOtpRequestedAt).getTime()
      : 0;
    const remainingDelay = verificationResendDelayMs - (Date.now() - requestedAt);
    if (remainingDelay > 0) {
      return res.status(429).json({
        error: "Please wait before requesting another verification code.",
        retryAfterSeconds: Math.ceil(remainingDelay / 1000),
      });
    }

    const [conflicts] = await sequelize.query(
      `SELECT 1
       FROM "UserInfo" AS info
       JOIN "UserAccounts" AS account ON account."UserInfoId" = info."UserInfoId"
       WHERE LOWER(info."Email") = :email AND account."UserId" <> :userId
       UNION ALL
       SELECT 1
       FROM "UserAccounts"
       WHERE "UserId" <> :userId
         AND (LOWER("RecoveryEmail") = :email OR LOWER("RecoveryEmailPending") = :email)
       LIMIT 1`,
      { replacements: { email, userId: user.UserId } },
    );
    if (conflicts.length) {
      return res.status(409).json({ error: "That email address is already associated with another account." });
    }

    const previousState = {
      pending: user.RecoveryEmailPending,
      hash: user.RecoveryEmailVerificationOtpHash,
      expiresAt: user.RecoveryEmailVerificationOtpExpiresAt,
      requestedAt: user.RecoveryEmailVerificationOtpRequestedAt,
      attempts: user.RecoveryEmailVerificationAttempts,
    };
    const code = String(crypto.randomInt(0, 10 ** 6)).padStart(6, "0");
    user.RecoveryEmailPending = email;
    user.RecoveryEmailVerificationOtpHash = crypto.createHash("sha256").update(code).digest("hex");
    user.RecoveryEmailVerificationOtpExpiresAt = new Date(Date.now() + verificationOtpExpiryMinutes * 60 * 1000);
    user.RecoveryEmailVerificationOtpRequestedAt = new Date();
    user.RecoveryEmailVerificationAttempts = 0;
    await user.save();

    const sent = await sendSecurityEmail({
      to: email,
      subject: "Verify your KhmerDigital recovery email",
      text: `Your KhmerDigital recovery email verification code is ${code}. It expires in ${verificationOtpExpiryMinutes} minutes.`,
    });
    if (!sent) {
      user.RecoveryEmailPending = previousState.pending;
      user.RecoveryEmailVerificationOtpHash = previousState.hash;
      user.RecoveryEmailVerificationOtpExpiresAt = previousState.expiresAt;
      user.RecoveryEmailVerificationOtpRequestedAt = previousState.requestedAt;
      user.RecoveryEmailVerificationAttempts = previousState.attempts;
      await user.save();
      return res.status(503).json({ error: "Verification email could not be sent. Please try again later." });
    }

    return res.json({
      message: "A verification code has been sent to your recovery email address.",
      maskedEmail: maskEmail(email),
    });
  } catch (error) {
    if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid or expired session." });
    }
    console.error("Recovery email verification code could not be sent", error);
    return res.status(500).json({ error: "Unable to send a recovery email verification code." });
  }
}

async function verifyRecoveryEmail(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });
  const code = String(req.body?.code || "").trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the 6-digit verification code." });

  let user;
  try {
    user = await findByToken(token);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
  if (!user) return res.status(401).json({ error: "User account is unavailable." });

  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  try {
    const result = await sequelize.transaction(async (transaction) => {
      const account = await UserAccount.findByPk(user.UserId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!account || !account.RecoveryEmailPending) return "missing";
      if (
        !account.RecoveryEmailVerificationOtpHash ||
        !account.RecoveryEmailVerificationOtpExpiresAt ||
        new Date(account.RecoveryEmailVerificationOtpExpiresAt).getTime() <= Date.now()
      ) return "invalid";
      if (Number(account.RecoveryEmailVerificationAttempts || 0) >= 5) {
        account.RecoveryEmailVerificationOtpHash = null;
        account.RecoveryEmailVerificationOtpExpiresAt = null;
        await account.save({ transaction });
        return "invalid";
      }
      if (account.RecoveryEmailVerificationOtpHash !== codeHash) {
        account.RecoveryEmailVerificationAttempts = Number(account.RecoveryEmailVerificationAttempts || 0) + 1;
        if (account.RecoveryEmailVerificationAttempts >= 5) {
          account.RecoveryEmailVerificationOtpHash = null;
          account.RecoveryEmailVerificationOtpExpiresAt = null;
        }
        await account.save({ transaction });
        return "invalid";
      }

      const recoveryEmail = String(account.RecoveryEmailPending).toLowerCase();
      const [conflicts] = await sequelize.query(
        `SELECT 1
         FROM "UserInfo" AS info
         JOIN "UserAccounts" AS other ON other."UserInfoId" = info."UserInfoId"
         WHERE LOWER(info."Email") = :email AND other."UserId" <> :userId
         UNION ALL
         SELECT 1
         FROM "UserAccounts"
         WHERE "UserId" <> :userId
           AND (LOWER("RecoveryEmail") = :email OR LOWER("RecoveryEmailPending") = :email)
         LIMIT 1`,
        { replacements: { email: recoveryEmail, userId: user.UserId }, transaction },
      );
      if (conflicts.length) {
        account.RecoveryEmailPending = null;
        account.RecoveryEmailVerificationOtpHash = null;
        account.RecoveryEmailVerificationOtpExpiresAt = null;
        account.RecoveryEmailVerificationOtpRequestedAt = null;
        account.RecoveryEmailVerificationAttempts = 0;
        await account.save({ transaction });
        return "conflict";
      }

      account.RecoveryEmail = account.RecoveryEmailPending;
      account.RecoveryEmailVerifiedAt = new Date();
      account.RecoveryEmailPending = null;
      account.RecoveryEmailVerificationOtpHash = null;
      account.RecoveryEmailVerificationOtpExpiresAt = null;
      account.RecoveryEmailVerificationOtpRequestedAt = null;
      account.RecoveryEmailVerificationAttempts = 0;
      await account.save({ transaction });
      return "verified";
    });

    if (result === "missing") return res.status(400).json({ error: "Request a recovery email verification code first." });
    if (result === "invalid") return res.status(400).json({ error: "This verification code is invalid, expired, or has reached the attempt limit." });
    if (result === "conflict") return res.status(409).json({ error: "That email address is already associated with another account. Request a code for a different address." });

    const updatedUser = await findByToken(token);
    return res.json({ user: toUser(updatedUser), message: "Your recovery email address has been verified." });
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({ error: "That recovery email address is already in use." });
    }
    console.error("Recovery email verification failed", error);
    return res.status(500).json({ error: "Unable to verify your recovery email address." });
  }
}

async function forgotPassword(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Email is required." });
  const response: { message: string; maskedEmail: string; otp?: string } = { message: `If the email exists, a ${otpLength}-digit OTP will be sent.`, maskedEmail: maskEmail(email) };

  try {
    const info = await UserInfo.findOne({ where: { Email: email }, include: [{ model: UserAccount, as: "account" }] });
    const account = info?.account || await UserAccount.findOne({
      where: { RecoveryEmail: email, RecoveryEmailVerifiedAt: { [Op.not]: null } },
      include: [{ model: UserInfo, as: "info" }],
    });
    if (!account) return res.json(response);

    const otp = String(crypto.randomInt(0, 10 ** otpLength)).padStart(otpLength, "0");
    account.ResetOtpHash = crypto.createHash("sha256").update(otp).digest("hex");
    account.ResetOtpExpiresAt = new Date(Date.now() + otpExpiryMinutes * 60 * 1000);
    await account.save();
    const emailSent = await sendSecurityEmail({ to: email, subject: "Your password reset code", text: `Your password reset OTP is ${otp}. It expires in ${otpExpiryMinutes} minutes.` });
    if (!emailSent && process.env.NODE_ENV !== "production") {
      response.otp = otp;
    }
    return res.json(response);
  } catch (error) {
    console.error("Forgot password failed", error);
    return res.status(500).json({ error: "Unable to process the password reset request." });
  }
}

async function resetPassword(req, res) {
  if (!requireDatabase(res, sequelize)) return;
  const email = String(req.body.email || "").trim().toLowerCase();
  const otp = String(req.body.otp || "").trim();
  const password = String(req.body.password || "");
  if (!email || otp.length !== otpLength || !/^\d+$/.test(otp) || password.length < 8) return res.status(400).json({ error: `Email, a ${otpLength}-digit OTP, and a password of at least 8 characters are required.` });
  const info = await UserInfo.findOne({ where: { Email: email }, include: [{ model: UserAccount, as: "account" }] });
  const account = info?.account || await UserAccount.findOne({
    where: { RecoveryEmail: email, RecoveryEmailVerifiedAt: { [Op.not]: null } },
    include: [{ model: UserInfo, as: "info" }],
  });
  const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
  if (!account || account.ResetOtpHash !== otpHash || !account.ResetOtpExpiresAt || account.ResetOtpExpiresAt <= new Date()) return res.status(400).json({ error: "This OTP is invalid or expired." });
  account.PasswordHash = await bcrypt.hash(password, 12);
  account.ResetOtpHash = null;
  account.ResetOtpExpiresAt = null;
  await account.save();
  await sendSecurityEmail({
    to: email,
    subject: "Your Digital Products Marketplace password was changed",
    text: "Your Digital Products Marketplace password was changed successfully. If this was not you, contact support immediately."
  });
  const primaryEmail = String(account.info?.Email || "").toLowerCase();
  if (primaryEmail && primaryEmail !== email) {
    await sendSecurityEmail({
      to: primaryEmail,
      subject: "Your Digital Products Marketplace password was changed",
      text: "Your password was reset using your recovery email address. If this was not you, secure your account and contact support immediately.",
    });
  }
  return res.json({ message: "Password reset successfully." });
}

module.exports = {
  me,
  updateProfile,
  requestEmailVerification,
  verifyEmail,
  requestRecoveryEmailVerification,
  verifyRecoveryEmail,
  forgotPassword,
  resetPassword,
};
