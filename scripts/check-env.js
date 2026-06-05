const config = require("../src/config");

const missing = [];
if (!config.telegramBotToken) missing.push("TELEGRAM_BOT_TOKEN");
if (!config.techLeadUserId) missing.push("TECH_LEAD_USER_ID");
if (!config.baseUrl) missing.push("BASE_URL");
if (!config.openClawApiToken) missing.push("OPENCLAW_API_TOKEN");

if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Environment looks ready.");
