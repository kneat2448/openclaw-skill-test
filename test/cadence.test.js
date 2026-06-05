const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCadenceInput, computeReviewDates } = require("../src/cadence");

test("cadence parser requires an end date and always includes end review", () => {
  const parsed = parseCadenceInput("weekly | start: 2026-06-01T10:00:00+05:30 | end: 2026-06-20T10:00:00+05:30");

  assert.equal(parsed.ok, true);
  assert.equal(parsed.cadence, "weekly");
  assert.equal(parsed.reviewDates.at(-1), parsed.endAt);
  assert.equal(parsed.nextReviewAt, parsed.reviewDates[0]);
});

test("halfway and end creates midpoint and mandatory final review", () => {
  const dates = computeReviewDates({
    cadence: "halfway_and_end",
    startAt: new Date("2026-06-01T00:00:00.000Z"),
    endAt: new Date("2026-06-11T00:00:00.000Z")
  }).map((date) => date.toISOString());

  assert.deepEqual(dates, [
    "2026-06-06T00:00:00.000Z",
    "2026-06-11T00:00:00.000Z"
  ]);
});

test("end cadence schedules only the mandatory final review", () => {
  const parsed = parseCadenceInput("end | end: 2026-06-20T10:00:00+05:30", new Date("2026-06-01T00:00:00.000Z"));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.reviewDates.length, 1);
  assert.equal(parsed.nextReviewAt, parsed.endAt);
});
