const { DataTypes } = require("sequelize");
const sequelize = require("./database");

module.exports = sequelize?.define("LegalPolicyVersion", {
  PolicyVersionId: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: "PolicyVersionId" },
  PolicyId: { type: DataTypes.INTEGER, allowNull: false, field: "PolicyId" },
  VersionNumber: { type: DataTypes.FLOAT, allowNull: false, field: "VersionNumber" },
  Title: { type: DataTypes.STRING(255), allowNull: false, field: "Title" },
  Slug: { type: DataTypes.STRING(255), allowNull: false, field: "Slug" },
  Category: { type: DataTypes.STRING(120), allowNull: false, field: "Category" },
  Description: { type: DataTypes.TEXT, field: "Description" },
  Content: { type: DataTypes.TEXT, field: "Content" },
  Status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "draft", field: "Status" },
  CreatedBy: { type: DataTypes.INTEGER, field: "CreatedBy" },
  CreatedAt: { type: DataTypes.DATE, field: "CreatedAt" },
  PublishedAt: { type: DataTypes.DATE, field: "PublishedAt" },
}, { tableName: "LegalPolicyVersions", timestamps: false });
