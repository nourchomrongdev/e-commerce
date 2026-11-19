const { DataTypes } = require("sequelize");
const sequelize = require("./database");

module.exports = sequelize?.define("CreatorProfile", {
  CreatorProfileId: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: "CreatorProfileId" },
  UUID: { type: DataTypes.UUID, unique: true, field: "UUID" },
  UserId: { type: DataTypes.INTEGER, allowNull: false, unique: true, field: "UserId" },
  DisplayName: { type: DataTypes.STRING(150), allowNull: false, field: "DisplayName" },
  Username: { type: DataTypes.STRING(100), allowNull: false, unique: true, field: "Username" },
  Bio: { type: DataTypes.TEXT, field: "Bio" },
  PhoneNumber: { type: DataTypes.STRING(50), field: "PhoneNumber" },
  AvatarUrl: { type: DataTypes.TEXT, field: "AvatarUrl" },
  BannerUrl: { type: DataTypes.TEXT, field: "BannerUrl" },
  WebsiteUrl: { type: DataTypes.TEXT, field: "WebsiteUrl" },
  SocialLinks: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: "SocialLinks" },
  IsVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "IsVerified" },
  AccountApprovalStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pending", field: "AccountApprovalStatus" },
  IdentityVerificationStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "unverified", field: "IdentityVerificationStatus" },
  IsActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "IsActive" },
  CreatedAt: { type: DataTypes.DATE, field: "CreatedAt" },
  UpdatedAt: { type: DataTypes.DATE, field: "UpdatedAt" },
}, { tableName: "CreatorProfiles", timestamps: false });