const test = require("node:test");
const assert = require("node:assert/strict");
const dbApi = require("../src/db");
const analysis = require("../src/analysis");
const jsonStore = require("../src/jsonStore");
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

test("dashboard analysis can be rebuilt from JSON project snapshot", () => {
  const db = tempDb();
  const projectId = sampleProject(db);
  const assignment = dbApi.getAssignments(db, projectId)[0];
  dbApi.saveResponse(db, assignment.id, parseReviewMessage(validReviewText(9), 15));
  const snapshot = jsonStore.syncProject(db, projectId);

  const dashboard = analysis.buildDashboardFromSnapshot(snapshot);

  assert.equal(dashboard.project.id, projectId);
  assert.equal(dashboard.teamMatrix.length, 3);
  assert.equal(dashboard.anonymity.reviewerIdentitiesExposed, false);
});

test("project lists merge sqlite and JSON project snapshot records", () => {
  const merged = jsonStore.mergeProjects(
    [{ id: 1, name: "SQLite", status: "scheduled" }],
    [{ project: { id: 2, name: "Snapshot", status: "complete" } }],
    [{ id: 1, name: "SQLite Snapshot", status: "analyzed", source: "project-json" }]
  );

  assert.deepEqual(merged.map((project) => project.id), [2, 1]);
  assert.equal(merged.find((project) => project.id === 1).name, "SQLite Snapshot");
  assert.equal(merged.find((project) => project.id === 2).name, "Snapshot");
});
