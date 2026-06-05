# Hostinger OpenClaw Integration Guide

Use this when OpenClaw is already running on a Hostinger VPS and this peer-review app needs to run beside it.

## Recommended Architecture

Run two separate services on the same VPS:

```text
Telegram users
  -> peer-review Telegram bot
  -> peer-review Node app on localhost:3001
  -> SQLite database in ./data/peer_review.db
  -> dashboard at https://your-domain.example/dashboard/:projectId

OpenClaw on Hostinger
  -> calls http://127.0.0.1:3001/internal/openclaw/*
  -> owns scheduled launch, reminders, completion checks, recovery, and alerts
```

Important: do not use the same Telegram bot token for OpenClaw's Telegram channel and this peer-review bot. Telegram polling allows only one active poller per bot token. Use either:

- one bot token for OpenClaw, and a second bot token for peer reviews; or
- disable this app's Telegram polling and build a deeper OpenClaw channel adapter later.

For this MVP, use two bot tokens.

## 1. Put The App On The Hostinger VPS

SSH into the VPS:

```bash
ssh root@YOUR_SERVER_IP
```

Choose a deploy directory:

```bash
mkdir -p /opt/peer-review-workflow
cd /opt/peer-review-workflow
```

Copy the project files from your machine to the VPS, or clone from Git if you push this repo:

```bash
git clone YOUR_REPO_URL /opt/peer-review-workflow
cd /opt/peer-review-workflow
```

Install dependencies:

```bash
npm install
npm run check
npm test
npm run smoke
```

## 2. Configure Environment

Create `.env`:

```bash
cp .env.example .env
nano .env
```

Use values like:

```text
TELEGRAM_BOT_TOKEN=<peer-review-bot-token-from-BotFather>
TECH_LEAD_USER_ID=<your-numeric-telegram-user-id>
BASE_URL=https://reviews.your-domain.example
PORT=3001
DB_PATH=./data/peer_review.db
APP_TIME_ZONE=Asia/Kolkata
LATER_REMIND_MS=14400000
OPENCLAW_API_TOKEN=<long-random-shared-secret>
AUTO_ANALYZE_ON_COMPLETE=true
```

Generate a strong token:

```bash
openssl rand -hex 32
```

## 3. Run The App As A Service

If you already use PM2:

```bash
npm install -g pm2
pm2 start src/server.js --name peer-review-workflow --time
pm2 save
pm2 startup
```

Check it:

```bash
curl http://127.0.0.1:3001/
```

Expected:

```json
{"ok":true,"app":"peer-review-workflow"}
```

## 4. Expose The Dashboard Publicly

If Hostinger uses Nginx, create a reverse proxy such as:

```nginx
server {
  listen 80;
  server_name reviews.your-domain.example;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Enable HTTPS with Certbot or Hostinger's SSL tooling. Then verify:

```bash
curl https://reviews.your-domain.example/
```

Set `.env` `BASE_URL` to this HTTPS URL and restart:

```bash
pm2 restart peer-review-workflow
```

## 5. Connect OpenClaw To The App

OpenClaw should call the app locally from the same VPS:

```text
http://127.0.0.1:3001/internal/openclaw/<command>
```

Use:

```text
Authorization: Bearer <OPENCLAW_API_TOKEN>
Content-Type: application/json
```

Example:

```bash
curl -X POST http://127.0.0.1:3001/internal/openclaw/reconcileMissedSchedules \
  -H "Authorization: Bearer $OPENCLAW_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Project-specific example:

```bash
curl -X POST http://127.0.0.1:3001/internal/openclaw/checkCompletion \
  -H "Authorization: Bearer $OPENCLAW_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":1}'
```

## 6. Tell The OpenClaw Agent What To Do

In the OpenClaw Control UI or Telegram channel, send:

```text
Use /opt/peer-review-workflow/OPENCLAW_AGENT_IMPLEMENTATION.md as your instruction file.

The peer-review service is running on http://127.0.0.1:3001.
Use Authorization: Bearer <OPENCLAW_API_TOKEN> for /internal/openclaw/* calls.

Create recurring automations for:
1. reconcileMissedSchedules on OpenClaw startup or daily
2. sendReminder every 15 minutes for active projects
3. checkCompletion every 15 minutes for active projects
4. runAnalysis when collection is complete or when the tech lead asks
```

## 7. Operational Checks

Check app logs:

```bash
pm2 logs peer-review-workflow
```

Check app status:

```bash
pm2 status
curl http://127.0.0.1:3001/api/projects
```

Check dashboard:

```text
https://reviews.your-domain.example/dashboard/<projectId>
```

## Security Notes

- Keep `/internal/openclaw/*` protected by `OPENCLAW_API_TOKEN`.
- Prefer localhost calls from OpenClaw to the app.
- Only expose the public dashboard/app URL through HTTPS.
- Do not commit `.env`, SQLite DB files, or generated dashboard JSON.
- Use separate Telegram bots for OpenClaw and peer reviews.
