const { cleanupRejectedProducts } = require("./rejectedProductCleanupService");

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let cleanupRunning = false;

async function runCleanup() {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    const result = await cleanupRejectedProducts();
    if (result.deletedProducts > 0 || result.skippedProducts > 0) {
      console.info("Rejected product retention cleanup completed.", result);
    }
  } catch (error) {
    console.error("Rejected product retention cleanup failed.", error);
  } finally {
    cleanupRunning = false;
  }
}

function startRejectedProductCleanupScheduler() {
  void runCleanup();
  const timer = setInterval(() => void runCleanup(), CLEANUP_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

module.exports = { startRejectedProductCleanupScheduler };
