const { DEFAULT_QUESTIONS } = require("./questions");

function parseScore(value) {
  const match = String(value || "").match(/(\d+(?:\.\d+)?)(?:\s*(?:\/|out of)\s*10)?/i);
  if (!match) return null;
  const score = Number(match[1]);
  if (!Number.isFinite(score) || score < 0 || score > 10) return null;
  return score;
}

function extractSection(text, names) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:${escaped})\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Strengths|Concerns|Recommendation)\\s*:|$)`, "i");
  const match = text.match(pattern);
  return match ? match[1].trim() : "";
}

function parseReviewMessage(text, questionCount = DEFAULT_QUESTIONS.length) {
  const scores = [];
  const missing = [];
  const invalid = [];

  for (let i = 1; i <= questionCount; i += 1) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${i}\\s*[\\.:\\)-]\\s*([^\\n]+)`, "i");
    const match = text.match(pattern);
    if (!match) {
      missing.push(i);
      scores.push(null);
      continue;
    }
    const score = parseScore(match[1]);
    if (score == null) {
      invalid.push(i);
      scores.push(null);
      continue;
    }
    scores.push(score);
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    scores,
    missing,
    invalid,
    strengths: extractSection(text, ["Strengths", "Strength"]),
    concerns: extractSection(text, ["Concerns", "Concern"]),
    recommendation: extractSection(text, ["Recommendation", "Recommend"])
  };
}

function formatReviewTemplate(assignment, questions = DEFAULT_QUESTIONS, previousScores = []) {
  const lines = [
    `Review for: ${assignment.reviewee_name}`,
    "",
    ...questions.map((question, index) => `${index + 1}: ${previousScores[index] ?? ""}  (${question})`),
    "",
    "Strengths:",
    "",
    "Concerns:",
    "",
    "Recommendation:"
  ];
  return lines.join("\n");
}

function formatValidationError(parsed, assignment, questions) {
  const parts = [`I could not store the review for ${assignment.reviewee_name} yet.`];
  if (parsed.missing.length) parts.push(`Missing answers: ${parsed.missing.join(", ")}`);
  if (parsed.invalid.length) parts.push(`Invalid scores: ${parsed.invalid.join(", ")}. Use 0-10, like 8, 7.5/10, or 8 out of 10.`);
  parts.push("");
  parts.push("Here is the template again with valid scores preserved:");
  parts.push("");
  parts.push(formatReviewTemplate(assignment, questions, parsed.scores));
  return parts.join("\n");
}

module.exports = {
  parseScore,
  parseReviewMessage,
  formatReviewTemplate,
  formatValidationError
};
