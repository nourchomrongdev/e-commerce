const { DataTypes } = require("sequelize");
const sequelize = require("./database");

module.exports = sequelize?.define("LegalPolicyAuditLog", {
  AuditLogId: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: "AuditLogId" },
  PolicyId: { type: DataTypes.INTEGER, allowNull: false, field: "PolicyId" },
  PolicyVersionId: { type: DataTypes.INTEGER, field: "PolicyVersionId" },
  Action: { type: DataTypes.STRING(80), allowNull: false, field: "Action" },
  ActorUserId: { type: DataTypes.INTEGER, field: "ActorUserId" },
  ActorName: { type: DataTypes.STRING(255), field: "ActorName" },
  Metadata: { type: DataTypes.JSONB, field: "Metadata" },
  CreatedAt: { type: DataTypes.DATE, field: "CreatedAt" },
}, { tableName: "LegalPolicyAuditLogs", timestamps: false });
