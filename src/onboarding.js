const crypto = require("crypto");

const ENV_FIELDS = [
  {
    key: "TELEGRAM_BOT_TOKEN",
    question: "Telegram bot token",
    defaultValue: "",
    required: false,
    help: "Leave blank for local development without Telegram delivery."
  },
  {
    key: "TECH_LEAD_USER_ID",
    question: "Tech lead Telegram user ID",
    defaultValue: "",
    required: true
  },
  {
    key: "BASE_URL",
    question: "Public base URL",
    defaultValue: "http://localhost:3000",
    required: true
  },
  {
    key: "PORT",
    question: "HTTP port",
    defaultValue: "3000",
    required: true,
    validate: (value) => (/^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536)
  },
  {
    key: "DB_PATH",
    question: "SQLite database path",
    defaultValue: "./data/peer_review.db",
    required: true
  },
  {
    key: "APP_TIME_ZONE",
    question: "App timezone",
    defaultValue: "Asia/Kolkata",
    required: true
  },
  {
    key: "LATER_REMIND_HOURS",
    envKey: "LATER_REMIND_MS",
    question: "Reminder delay in hours",
    defaultValue: "4",
    required: true,
    validate: (value) => Number.isFinite(Number(value)) && Number(value) > 0,
    transform: (value) => String(Math.round(Number(value) * 60 * 60 * 1000)),
    display: (value) => {
      const hours = Number(value) / (60 * 60 * 1000);
      return Number.isFinite(hours) ? String(hours) : "4";
    }
  },
  {
    key: "OPENCLAW_API_TOKEN",
    question: "OpenClaw API token",
    defaultValue: () => crypto.randomBytes(24).toString("hex"),
    required: true,
    help: "Press Enter to generate a token."
  },
  {
    key: "AUTO_ANALYZE_ON_COMPLETE",
    question: "Auto-analyze when all reviews are complete",
    defaultValue: "true",
    required: true,
    validate: (value) => /^(true|false|yes|no|1|0|on|off)$/i.test(value),
    transform: (value) => (["1", "true", "yes", "on"].includes(value.toLowerCase()) ? "true" : "false")
  }
];

function parseEnvContent(content = "") {
  const values = {};
  const order = [];
  for (const line of String(content).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = unquoteEnvValue(match[2]);
    order.push(match[1]);
  }
  return { values, order };
}

function unquoteEnvValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function quoteEnvValue(value) {
  const stringValue = String(value ?? "");
  if (!/[#\s"'\\]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function defaultFor(field) {
  return typeof field.defaultValue === "function" ? field.defaultValue() : field.defaultValue;
}

function existingValueFor(field, existingValues) {
  const envKey = field.envKey || field.key;
  const value = existingValues[envKey];
  if (value == null || value === "") return defaultFor(field);
  return field.display ? field.display(value) : value;
}

function normalizeOnboardingAnswers(answers) {
  const env = {};
  const errors = [];

  for (const field of ENV_FIELDS) {
    const validation = validateOnboardingField(field, answers[field.key]);
    if (!validation.ok) {
      errors.push(validation.error);
      continue;
    }
    env[field.envKey || field.key] = validation.envValue;
  }

  return { ok: errors.length === 0, errors, env };
}

function validateOnboardingField(field, answer) {
  const rawValue = String(answer ?? "").trim();
  const value = rawValue || defaultFor(field);
  if (field.required && !value) return { ok: false, error: `${field.key} is required` };
  if (value && field.validate && !field.validate(value)) return { ok: false, error: `${field.key} is invalid` };
  return {
    ok: true,
    envValue: field.transform ? field.transform(value) : value
  };
}

function mergeEnvContent(existingContent, nextValues) {
  const { values, order } = parseEnvContent(existingContent);
  const merged = { ...values, ...nextValues };
  const fieldKeys = ENV_FIELDS.map((field) => field.envKey || field.key);
  const orderedKeys = [
    ...order.filter((key) => key in merged),
    ...fieldKeys.filter((key) => !order.includes(key))
  ];
  const seen = new Set();
  return orderedKeys
    .filter((key) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((key) => `${key}=${quoteEnvValue(merged[key])}`)
    .join("\n")
    .concat("\n");
}

module.exports = {
  ENV_FIELDS,
  parseEnvContent,
  existingValueFor,
  validateOnboardingField,
  normalizeOnboardingAnswers,
  mergeEnvContent
};
