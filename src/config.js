const path = require("path");
require("dotenv").config();

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

const rootDir = path.resolve(__dirname, "..");

module.exports = {
  rootDir,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  techLeadUserId: String(process.env.TECH_LEAD_USER_ID || ""),
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
  port: Number(process.env.PORT || 3000),
  dbPath: path.resolve(rootDir, process.env.DB_PATH || "./data/peer_review.db"),
  appTimeZone: process.env.APP_TIME_ZONE || "Asia/Kolkata",
  laterRemindMs: Number(process.env.LATER_REMIND_MS || 14400000),
  openClawApiToken: process.env.OPENCLAW_API_TOKEN || "",
  autoAnalyzeOnComplete: boolEnv("AUTO_ANALYZE_ON_COMPLETE", true)
};
