const test = require("node:test");
const assert = require("node:assert/strict");
const dbApi = require("../src/db");
const analysis = require("../src/analysis");
const { parseReviewMessage } = require("../src/reviewParser");
const { tempDb, sampleProject, validReviewText } = require("./helpers");

test("dashboard is anonymous and shows no responses for uncovered members", () => {
  const db = tempDb();
  const projectId = sampleProject(db);
  const assignment = dbApi.getAssignments(db, projectId)[0];
  dbApi.saveResponse(db, assignment.id, parseReviewMessage(validReviewText(9), 15));

  const dashboard = analysis.buildDashboard(db, projectId);

  assert.equal(dashboard.anonymity.reviewerIdentitiesExposed, false);
  assert.equal(JSON.stringify(dashboard).includes("reviewerName"), false);
  assert.ok(dashboard.teamMatrix.some((row) => row.responseDisplay === "No responses" && row.risk === "Unknown"));
  assert.equal(dashboard.decisionScorecard.length, 3);
});
