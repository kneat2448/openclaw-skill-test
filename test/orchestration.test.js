const test = require("node:test");
const assert = require("node:assert/strict");
const dbApi = require("../src/db");
const { createOrchestration } = require("../src/orchestration");
const { tempDb, sampleProject } = require("./helpers");

test("orchestration starts due scheduled workflows after downtime", async () => {
  const db = tempDb();
  const projectId = sampleProject(db);
  db.prepare("UPDATE projects SET schedule_at = ?, status = 'scheduled' WHERE id = ?")
    .run(new Date(Date.now() - 10000).toISOString(), projectId);
  db.prepare("UPDATE openclaw_workflows SET next_run_at = ? WHERE project_id = ?")
    .run(new Date(Date.now() - 10000).toISOString(), projectId);
  const sent = [];
  const orchestration = createOrchestration({
    db,
    notifier: { sendReviewInvites: async (id) => sent.push(id) }
  });

  const result = await orchestration.reconcileMissedSchedules();

  assert.deepEqual(result.started, [projectId]);
  assert.deepEqual(sent, [projectId]);
  assert.equal(dbApi.getProject(db, projectId).status, "collecting");
});

test("completion auto-analysis runs when all assignments are submitted", async () => {
  const db = tempDb();
  const projectId = dbApi.createProject(db, {
    name: "Tiny",
    roster: [
      { name: "A", telegramUserId: "1" },
      { name: "B", telegramUserId: "2" }
    ],
    questions: Array.from({ length: 15 }, (_, index) => `Question ${index + 1}`)
  });
  db.prepare("UPDATE review_assignments SET status = 'submitted', submitted_at = ? WHERE project_id = ?")
    .run(new Date().toISOString(), projectId);
  const orchestration = createOrchestration({ db });

  const result = await orchestration.checkCompletion(projectId);

  assert.equal(result.completion.complete, true);
  assert.equal(result.analyzed, true);
});
