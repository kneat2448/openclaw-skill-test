const test = require("node:test");
const assert = require("node:assert/strict");
const dbApi = require("../src/db");
const { tempDb, sampleProject } = require("./helpers");

test("assignment generation creates every reviewer-reviewee pair except self reviews", () => {
  const db = tempDb();
  const projectId = sampleProject(db);
  const assignments = dbApi.getAssignments(db, projectId);

  assert.equal(assignments.length, 6);
  assert.equal(assignments.some((assignment) => assignment.reviewer_member_id === assignment.reviewee_member_id), false);

  dbApi.generateAssignments(db, projectId);
  assert.equal(dbApi.getAssignments(db, projectId).length, 6);
});

test("members without Telegram IDs are routed through proxy delivery", () => {
  const db = tempDb();
  const projectId = dbApi.createProject(db, {
    name: "Proxy",
    roster: [
      { name: "A", telegramUserId: "" },
      { name: "B", telegramUserId: "200" }
    ],
    questions: Array.from({ length: 15 }, (_, index) => `Question ${index + 1}`)
  });

  const assignments = dbApi.getAssignments(db, projectId);
  const proxy = assignments.find((assignment) => assignment.reviewer_name === "A");
  assert.equal(proxy.proxy_delivery, 1);
});
