const assert = require("node:assert/strict");
const dbApi = require("../src/db");
const analysis = require("../src/analysis");
const { parseReviewMessage } = require("../src/reviewParser");
const { createOrchestration } = require("../src/orchestration");
const { tempDb, validReviewText } = require("../test/helpers");

(async () => {
  const db = tempDb();
  const projectId = dbApi.createProject(db, {
    name: "Smoke",
    description: "End-to-end smoke test",
    reviewGoal: "Validate workflow",
    scheduleAt: new Date().toISOString(),
    sensitiveNotes: "Do not leak",
    questions: Array.from({ length: 15 }, (_, index) => `Question ${index + 1}`),
    roster: [
      { name: "Priya", role: "Engineer", telegramUserId: "101" },
      { name: "Sam", role: "Designer", telegramUserId: "102" }
    ]
  });
  const orchestration = createOrchestration({ db });
  await orchestration.startReviewRound(projectId);
  for (const assignment of dbApi.getAssignments(db, projectId)) {
    dbApi.saveResponse(db, assignment.id, parseReviewMessage(validReviewText(8), 15));
  }
  const completion = await orchestration.checkCompletion(projectId);
  const dashboard = analysis.buildDashboard(db, projectId);

  assert.equal(completion.completion.complete, true);
  assert.equal(dashboard.anonymity.reviewerIdentitiesExposed, false);
  assert.equal(JSON.stringify(dashboard).includes("Do not leak"), false);
  console.log(`Smoke passed for project #${projectId}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
