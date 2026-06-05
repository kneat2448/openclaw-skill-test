# Telegram Peer Review Workflow

Telegram-first peer review MVP with SQLite storage, anonymous dashboard output, and OpenClaw orchestration hooks.

## What It Does

- Tech lead creates a project through guided Telegram prompts.
- The app stores project details, roster, cadence, question template, and sensitive notes separately.
- Each reviewer is assigned every teammate except themselves.
- Reviewers submit one structured message per teammate.
- OpenClaw can trigger review starts, reminders, completion checks, analysis, and alerts through internal endpoints.
- Dashboard output is anonymous by default and includes a project dropdown, live analysis, a team matrix, narrative report, and decision scorecard.

## Local Setup

```bash
npm install
copy .env.example .env
npm start
```

Required `.env` values for live Telegram/OpenClaw use:

- `TELEGRAM_BOT_TOKEN`
- `TECH_LEAD_USER_ID`
- `BASE_URL`
- `OPENCLAW_API_TOKEN`

Without a Telegram token, the app still starts and logs outgoing bot messages to the console.

## Telegram Commands

- `create project`
- `projects`
- `start review [project]`
- `pause review [project]`
- `resume review [project]`
- `send reminder [project]`
- `analyze reviews [project]`
- `dashboard [project]`
- `status [project]`
- `export reviews [project]`

## Reviewer Message Format

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

## Project Review Cadence

During `create project`, the bot asks for cadence instead of a single launch timestamp. The end-of-project review is always mandatory.

Examples:

```text
weekly | end: 2026-08-30T17:00:00+05:30
biweekly | end: 2026-08-30T17:00:00+05:30
halfway | end: 2026-08-30T17:00:00+05:30
halfway and end | end: 2026-08-30T17:00:00+05:30
end | end: 2026-08-30T17:00:00+05:30
```

Optional start date:

```text
weekly | start: 2026-06-10T10:00:00+05:30 | end: 2026-08-30T17:00:00+05:30
```

## OpenClaw Endpoints

OpenClaw should call `POST /internal/openclaw/:command` with `Authorization: Bearer $OPENCLAW_API_TOKEN`.

Supported commands:

- `createWorkflow`
- `startReviewRound`
- `sendReminder`
- `checkCompletion`
- `runAnalysis`
- `notifyLead`
- `pauseReview`
- `resumeReview`
- `reconcileMissedSchedules`

See [openclaw/peer-review-workflow.md](openclaw/peer-review-workflow.md) for the orchestration contract.

For a full prompt/instruction file that can be handed to an OpenClaw agent, use [OPENCLAW_AGENT_IMPLEMENTATION.md](OPENCLAW_AGENT_IMPLEMENTATION.md).

For deploying beside an existing OpenClaw instance on Hostinger, use [HOSTINGER_OPENCLAW_SETUP.md](HOSTINGER_OPENCLAW_SETUP.md).

## Dashboard Analysis

The dashboard loads projects from `/api/projects` and analysis from `/api/projects/:projectId/dashboard`. It no longer depends on generated JSON files being present, though `analyze reviews [project]` still writes dashboard JSON for compatibility.

## Verification

```bash
npm run check
npm test
npm run smoke
```
