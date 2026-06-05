const VALID_CADENCES = new Set(["weekly", "biweekly", "halfway", "halfway_and_end", "end"]);

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeCadenceName(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  if (normalized === "bi_weekly" || normalized === "biweekly") return "biweekly";
  if (normalized === "halfway_end" || normalized === "halfway_and_end" || normalized === "halfway+end") return "halfway_and_end";
  if (normalized === "week") return "weekly";
  if (normalized === "final") return "end";
  return normalized;
}

function parseCadenceInput(text, now = new Date()) {
  const input = String(text || "").trim();
  const parts = input.split("|").map((part) => part.trim()).filter(Boolean);
  const cadence = normalizeCadenceName(parts[0]);
  if (!VALID_CADENCES.has(cadence)) return { ok: false, error: "unknown_cadence" };

  let startAt = now;
  let endAt = null;

  for (const part of parts.slice(1)) {
    const [rawKey, ...rawValue] = part.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (key === "start") {
      const parsed = parseDateOrNow(value, now);
      if (!parsed) return { ok: false, error: "invalid_start" };
      startAt = parsed;
    }
    if (key === "end") {
      const parsed = parseDateOrNow(value, now);
      if (!parsed) return { ok: false, error: "invalid_end" };
      endAt = parsed;
    }
  }

  if (!endAt) return { ok: false, error: "missing_end" };
  if (endAt <= startAt) return { ok: false, error: "end_before_start" };

  const reviewDates = computeReviewDates({ cadence, startAt, endAt });
  return {
    ok: true,
    cadence,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    reviewDates: reviewDates.map((date) => date.toISOString()),
    nextReviewAt: reviewDates[0]?.toISOString() || endAt.toISOString()
  };
}

function parseDateOrNow(value, now) {
  if (/^now$/i.test(value)) return new Date(now);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeReviewDates({ cadence, startAt, endAt }) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const dates = [];

  if (cadence === "weekly" || cadence === "biweekly") {
    const intervalDays = cadence === "weekly" ? 7 : 14;
    for (let cursor = addDays(start, intervalDays); cursor < end; cursor = addDays(cursor, intervalDays)) {
      dates.push(cursor);
    }
  }

  if (cadence === "halfway" || cadence === "halfway_and_end") {
    const midway = new Date(start.getTime() + Math.floor((end.getTime() - start.getTime()) / 2));
    if (midway > start && midway < end) dates.push(midway);
  }

  dates.push(end);

  const unique = Array.from(new Map(dates.map((date) => [date.toISOString(), date])).values());
  unique.sort((a, b) => a - b);
  return unique;
}

function describeCadence(cadence) {
  const labels = {
    weekly: "weekly, plus mandatory end review",
    biweekly: "biweekly, plus mandatory end review",
    halfway: "halfway and mandatory end review",
    halfway_and_end: "halfway and mandatory end review",
    end: "mandatory end review only"
  };
  return labels[cadence] || cadence;
}

module.exports = {
  parseCadenceInput,
  computeReviewDates,
  describeCadence,
  normalizeCadenceName
};
