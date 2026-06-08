---
name: peer-review-workflow
description: OpenClaw orchestration contract for Telegram peer reviews.
---

# Peer Review Workflow Orchestration

OpenClaw should treat the Node app as the domain service and call these internal endpoints.

Base URL: `${BASE_URL}`

Authorization: `Bearer ${OPENCLAW_API_TOKEN}`

Readiness: `GET /ready` should return `ok: true` before OpenClaw starts recurring automation.

## Commands

- `POST /internal/openclaw/createWorkflow` with `{ "projectId": 1 }`
- `POST /internal/openclaw/startReviewRound` with `{ "projectId": 1 }`
- `POST /internal/openclaw/sendReminder` with `{ "projectId": 1 }`
- `POST /internal/openclaw/checkCompletion` with `{ "projectId": 1 }`
- `POST /internal/openclaw/runAnalysis` with `{ "projectId": 1 }`
- `POST /internal/openclaw/notifyLead` with `{ "message": "..." }`
- `POST /internal/openclaw/pauseReview` with `{ "projectId": 1 }`
- `POST /internal/openclaw/resumeReview` with `{ "projectId": 1 }`
- `POST /internal/openclaw/reconcileMissedSchedules` with `{}`

The service returns `503` for all `/internal/openclaw/*` calls when `OPENCLAW_API_TOKEN` is missing or still set to `change-me`. Project commands require a positive integer `projectId`; `notifyLead` requires a non-empty `message`.

## Ownership

- SQLite remains the source of truth.
- OpenClaw owns scheduling, reminders, recovery, and alerts.
- Telegram remains the main interaction channel.
- Dashboard data is anonymous by default.
