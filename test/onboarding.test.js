const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseEnvContent,
  normalizeOnboardingAnswers,
  mergeEnvContent
} = require("../src/onboarding");

test("onboarding normalizes required setup answers into env values", () => {
  const result = normalizeOnboardingAnswers({
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TECH_LEAD_USER_ID: "12345",
    BASE_URL: "https://reviews.example.com",
    PORT: "3000",
    DB_PATH: "./data/peer_review.db",
    APP_TIME_ZONE: "Asia/Kolkata",
    LATER_REMIND_HOURS: "6",
    OPENCLAW_API_TOKEN: "openclaw-token",
    AUTO_ANALYZE_ON_COMPLETE: "yes"
  });

  assert.equal(result.ok, true);
  assert.equal(result.env.LATER_REMIND_MS, String(6 * 60 * 60 * 1000));
  assert.equal(result.env.AUTO_ANALYZE_ON_COMPLETE, "true");
});

test("onboarding preserves unrelated env values while updating setup fields", () => {
  const existing = [
    "CUSTOM_FLAG=keep-me",
    "PORT=3000",
    "OPENCLAW_API_TOKEN=old-token"
  ].join("\n");
  const merged = mergeEnvContent(existing, {
    PORT: "4000",
    TECH_LEAD_USER_ID: "12345",
    OPENCLAW_API_TOKEN: "new-token"
  });
  const parsed = parseEnvContent(merged).values;

  assert.equal(parsed.CUSTOM_FLAG, "keep-me");
  assert.equal(parsed.PORT, "4000");
  assert.equal(parsed.TECH_LEAD_USER_ID, "12345");
  assert.equal(parsed.OPENCLAW_API_TOKEN, "new-token");
});

test("onboarding rejects missing tech lead and invalid port", () => {
  const result = normalizeOnboardingAnswers({
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TECH_LEAD_USER_ID: "",
    BASE_URL: "https://reviews.example.com",
    PORT: "99999",
    DB_PATH: "./data/peer_review.db",
    APP_TIME_ZONE: "Asia/Kolkata",
    LATER_REMIND_HOURS: "4",
    OPENCLAW_API_TOKEN: "openclaw-token",
    AUTO_ANALYZE_ON_COMPLETE: "true"
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("TECH_LEAD_USER_ID is required"));
  assert.ok(result.errors.includes("PORT is invalid"));
});
