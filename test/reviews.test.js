const test = require("node:test");
const assert = require("node:assert/strict");
const dbApi = require("../src/db");
const { parseReviewMessage } = require("../src/reviewParser");
const { tempDb, sampleProject, validReviewText } = require("./helpers");

test("review parser accepts tolerant score formats and text sections", () => {
  const parsed = parseReviewMessage(validReviewText("7.5"), 15);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.scores[0], 7.5);
  assert.match(parsed.strengths, /ownership/);
  assert.match(parsed.concerns, /speed/);
});

test("review parser reports missing and invalid answers", () => {
  const parsed = parseReviewMessage("1: 8/10\n2: eleven", 3);

  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.missing, [3]);
  assert.deepEqual(parsed.invalid, [2]);
});

test("response save marks assignment submitted and prevents duplicate submissions", () => {
  const db = tempDb();
  const projectId = sampleProject(db);
  const assignment = dbApi.getAssignments(db, projectId)[0];
  const parsed = parseReviewMessage(validReviewText(8), 15);

  dbApi.saveResponse(db, assignment.id, parsed);
  assert.equal(dbApi.getAssignments(db, projectId).find((item) => item.id === assignment.id).status, "submitted");
  assert.throws(() => dbApi.saveResponse(db, assignment.id, parsed), /already submitted/);
});
