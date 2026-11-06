const { DataTypes } = require("sequelize");
const sequelize = require("./database");

module.exports = sequelize?.define("LegalPolicy", {
  PolicyId: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: "PolicyId" },
  PolicyKey: { type: DataTypes.STRING(120), allowNull: false, unique: true, field: "PolicyKey" },
  Title: { type: DataTypes.STRING(255), allowNull: false, field: "Title" },
  Slug: { type: DataTypes.STRING(255), allowNull: false, field: "Slug" },
  Category: { type: DataTypes.STRING(120), allowNull: false, field: "Category" },
  Description: { type: DataTypes.TEXT, field: "Description" },
  Content: { type: DataTypes.TEXT, field: "Content" },
  ContentJson: { type: DataTypes.JSONB, field: "ContentJson" },
  Status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "draft", field: "Status" },
  Version: { type: DataTypes.FLOAT, defaultValue: 1, field: "Version" },
  PublishedVersion: { type: DataTypes.FLOAT, field: "PublishedVersion" },
  CreatedBy: { type: DataTypes.INTEGER, field: "CreatedBy" },
  UpdatedBy: { type: DataTypes.INTEGER, field: "UpdatedBy" },
  CreatedAt: { type: DataTypes.DATE, field: "CreatedAt" },
  UpdatedAt: { type: DataTypes.DATE, field: "UpdatedAt" },
  PublishedAt: { type: DataTypes.DATE, field: "PublishedAt" },
  DeletedAt: { type: DataTypes.DATE, field: "DeletedAt" },
}, { tableName: "LegalPolicies", timestamps: false });
