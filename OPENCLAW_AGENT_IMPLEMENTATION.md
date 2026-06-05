# OpenClaw Agent Implementation Instructions

Use this file when asking an OpenClaw agent to install, configure, run, or operate this repository.

## Mission

Implement the entire `peer-review-workflow` folder as a Telegram-first peer review service with OpenClaw as the automation/orchestration layer.

The Node app is the domain service. It owns SQLite data, Telegram review flows, review cadence, review parsing, live dashboard analysis, exports, and dashboard generation. OpenClaw owns recurring automation: starting scheduled reviews, sending reminders, checking completion, triggering analysis, reconciling missed schedules, and notifying the tech lead.

## Repository Contract

Expected root:

```text
peer-review-workflow/
  src/
  scripts/
  test/
  dashboard/
  openclaw/
  package.json
  .env.example
```

Do not store secrets in Git. Create or update `.env` locally from `.env.example`.

Required runtime values:

```text
TELEGRAM_BOT_TOKEN=<BotFather token>
TECH_LEAD_USER_ID=<numeric Telegram user id>
BASE_URL=<public URL for dashboards and internal OpenClaw calls>
OPENCLAW_API_TOKEN=<shared secret for OpenClaw internal endpoint calls>
PORT=3000
DB_PATH=./data/peer_review.db
APP_TIME_ZONE=Asia/Kolkata
AUTO_ANALYZE_ON_COMPLETE=true
```

Project creation asks for cadence, not a one-off launch date. The end-of-project review is always mandatory. Supported cadence examples:

```text
weekly | end: 2026-08-30T17:00:00+05:30
biweekly | end: 2026-08-30T17:00:00+05:30
halfway | end: 2026-08-30T17:00:00+05:30
halfway and end | end: 2026-08-30T17:00:00+05:30
end | end: 2026-08-30T17:00:00+05:30
```

If running locally, expose `PORT` with a stable tunnel such as ngrok, localtunnel, Tailscale, or another approved OpenClaw remote-access path, then set `BASE_URL` to that public URL.

## Install And Verify

From the repo root:

```bash
npm install
npm run check
npm test
npm run smoke
```

Expected result:

- Syntax checks pass.
- Node test suite passes.
- Smoke test creates an in-memory project, starts a review round, saves responses, runs completion/analysis, and confirms dashboard anonymity.
- `npm audit --omit=dev` should report zero vulnerabilities.

## Start The Service

Development:

```bash
npm start
```

Production-style process:

```bash
PORT=3000 npm start
```

Health check:

```bash
curl -s "$BASE_URL/"
```

Expected:

```json
{"ok":true,"app":"peer-review-workflow"}
```

Dashboard shell:

```bash
curl -I "$BASE_URL/dashboard/1"
```

Expected HTTP status: `200`.

## OpenClaw Orchestration Setup

Register this folder as the workspace/project that OpenClaw should operate. OpenClaw should call the Node service through these internal endpoints:

```text
POST /internal/openclaw/createWorkflow
POST /internal/openclaw/startReviewRound
POST /internal/openclaw/sendReminder
POST /internal/openclaw/checkCompletion
POST /internal/openclaw/runAnalysis
POST /internal/openclaw/notifyLead
POST /internal/openclaw/pauseReview
POST /internal/openclaw/resumeReview
POST /internal/openclaw/reconcileMissedSchedules
```

All calls require:

```text
Authorization: Bearer $OPENCLAW_API_TOKEN
Content-Type: application/json
```

Project commands use:

```json
{ "projectId": 1 }
```

Lead notification uses:

```json
{ "message": "Review collection is complete for Project Alpha." }
```

Missed-schedule reconciliation uses:

```json
{}
```

## Automation Rules For OpenClaw

Create these OpenClaw automations or equivalent recurring tasks:

1. Scheduled launch
   - Trigger: each project's `openclaw_workflows.next_run_at`, derived from review cadence.
   - Action: `POST $BASE_URL/internal/openclaw/startReviewRound`.

2. Reminder loop
   - Trigger: every 15 minutes.
   - Action: call `sendReminder` for active collecting projects.
   - Purpose: remind reviewers with `pending`, `in_progress`, or `needs_fix` assignments.

3. Completion check
   - Trigger: every 15 minutes and after reminders.
   - Action: `POST $BASE_URL/internal/openclaw/checkCompletion`.
   - Purpose: mark complete and auto-run analysis when `AUTO_ANALYZE_ON_COMPLETE=true`.

4. Recovery after restart
   - Trigger: OpenClaw startup and Node service restart.
   - Action: `POST $BASE_URL/internal/openclaw/reconcileMissedSchedules`.
   - Purpose: start scheduled reviews missed while either process was offline.

5. Operator alert
   - Trigger: failed send, unreachable Telegram user, failed automation call, or repeated validation failure.
   - Action: `POST $BASE_URL/internal/openclaw/notifyLead`.

## Telegram Workflow To Preserve

Tech lead commands:

```text
create project
projects
start review [project]
pause review [project]
resume review [project]
send reminder [project]
analyze reviews [project]
dashboard [project]
status [project]
export reviews [project]
```

Reviewer behavior:

- Each reviewer reviews every teammate except themselves.
- Cadence controls when review rounds happen; the final end-of-project review is always included.
- One message equals one teammate review.
- Keep reviewer identity anonymous in dashboard output.
- Sensitive project notes must never be included in dashboard JSON, anonymous exports, logs, or analysis output.

Review message format:

```text
Review for: Priya

1: 8/10
2: 7.5/10
3: 9/10
...
15: 8 out of 10

Strengths:
Clear ownership and communication.

Concerns:
Could improve delivery speed.

Recommendation:
Good fit.
```

## Acceptance Criteria

The OpenClaw agent is done only when:

- `.env` is configured locally.
- Dependencies are installed.
- The service starts successfully.
- Health check returns `{"ok":true,"app":"peer-review-workflow"}`.
- Tests and smoke test pass.
- OpenClaw can call all internal endpoints with the bearer token.
- A Telegram tech lead can create a project through guided prompts.
- Review assignments exclude self-reviews.
- Dashboard output stays anonymous and excludes sensitive notes.
- A recovery call to `reconcileMissedSchedules` is configured on startup.

## Safety Notes

- Never commit `.env`, `data/*.db`, generated dashboard JSON, or runtime files.
- Do not expose `/internal/openclaw/*` without `OPENCLAW_API_TOKEN`.
- Prefer private network/Tailscale access for internal automation calls when possible.
- Keep SQLite as the source of truth for this MVP.
