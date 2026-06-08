const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const {
  ENV_FIELDS,
  parseEnvContent,
  existingValueFor,
  validateOnboardingField,
  normalizeOnboardingAnswers,
  mergeEnvContent
} = require("../src/onboarding");

const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");

async function main() {
  const existingContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const { values } = parseEnvContent(existingContent);
  const answers = {};
  const rl = readline.createInterface({ input, output });

  try {
    console.log("Peer Review Workflow onboarding");
    console.log("Press Enter to accept the value shown in brackets.\n");

    for (const field of ENV_FIELDS) {
      const current = existingValueFor(field, values);
      const help = field.help ? `\n  ${field.help}` : "";
      const suffix = current ? ` [${current}]` : "";
      let answer = "";
      for (;;) {
        answer = await rl.question(`${field.question}${suffix}:${help}\n> `);
        answers[field.key] = answer.trim() || current;
        const validation = validateOnboardingField(field, answers[field.key]);
        if (validation.ok) break;
        console.log(`  ${validation.error}`);
      }
      console.log("");
    }
  } finally {
    rl.close();
  }

  const normalized = normalizeOnboardingAnswers(answers);
  if (!normalized.ok) {
    console.error(`Could not save setup: ${normalized.errors.join(", ")}`);
    process.exit(1);
  }

  fs.writeFileSync(envPath, mergeEnvContent(existingContent, normalized.env));
  console.log(`Saved onboarding settings to ${envPath}`);
  console.log("Run `npm run check-env` to verify the environment.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
