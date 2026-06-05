const os = require("os");
const path = require("path");
const dbApi = require("../src/db");

function tempDb() {
  const dbPath = path.join(os.tmpdir(), `peer-review-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  return dbApi.openDatabase(dbPath);
}

function sampleProject(db) {
  return dbApi.createProject(db, {
    name: "Alpha",
    description: "Launch review",
    reviewGoal: "Improve collaboration",
    scheduleAt: new Date(Date.now() + 10000).toISOString(),
    sensitiveNotes: "Private comp notes",
    questions: Array.from({ length: 15 }, (_, index) => `Question ${index + 1}`),
    roster: [
      { name: "Priya", role: "Engineer", telegramUserId: "101" },
      { name: "Sam", role: "Designer", telegramUserId: "102" },
      { name: "Lee", role: "PM", telegramUserId: "103" }
    ]
  });
}

function validReviewText(score = 8) {
  return [
    "Review for: Sam",
    "",
    ...Array.from({ length: 15 }, (_, index) => `${index + 1}: ${score}/10`),
    "",
    "Strengths:",
    "Strong ownership and communication.",
    "",
    "Concerns:",
    "Could improve speed.",
    "",
    "Recommendation:",
    "Good fit."
  ].join("\n");
}

module.exports = {
  tempDb,
  sampleProject,
  validReviewText
};
