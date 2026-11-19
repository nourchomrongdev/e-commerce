const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const apiRoutes = require("./routes/apiRoutes");
const { startFinanceScheduler } = require("./services/creatorFinanceScheduler");
const { startRejectedProductCleanupScheduler } = require("./services/rejectedProductCleanupScheduler");

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(cors());
app.use(express.json({ limit: "1gb" }));
app.use("/api", apiRoutes);

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("Unhandled API error:", error);
  const status = Number(error.status || error.statusCode);
  if (status === 413) return res.status(413).json({ error: "Request payload exceeds the configured size limit." });
  return res.status(500).json({ error: "Internal server error." });
});

app.get("/", (req, res) => {
  res.json({
    message: "Digital Products Marketplace API is running!"
  });
});

app.listen(PORT, () => {
  console.log(`Express server running at http://localhost:${PORT}`);
});

startFinanceScheduler();
startRejectedProductCleanupScheduler();
