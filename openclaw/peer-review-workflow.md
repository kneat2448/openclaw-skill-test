---
name: peer-review-workflow
description: OpenClaw orchestration contract for Telegram peer reviews.
---

# Peer Review Workflow Orchestration

OpenClaw should treat the Node app as the domain service and call these internal endpoints.

Base URL: `${BASE_URL}`

Authorization: `Bearer ${OPENCLAW_API_TOKEN}`

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

## Ownership

- SQLite remains the source of truth.
- OpenClaw owns scheduling, reminders, recovery, and alerts.
- Telegram remains the main interaction channel.
- Dashboard data is anonymous by default.
