const http = require("http");
const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../src/config");
const { createApp } = require("../src/server");
const { tempDb } = require("./helpers");

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  return { status: response.status, body };
}

test("health and readiness report service state", async () => {
  const db = tempDb();
  const originalToken = config.openClawApiToken;
  config.openClawApiToken = "test-token";
  const app = createApp({ db, botController: null });

  try {
    await withServer(app, async (baseUrl) => {
      const health = await requestJson(baseUrl, "/health");
      const ready = await requestJson(baseUrl, "/ready");

      assert.equal(health.status, 200);
      assert.equal(health.body.ok, true);
      assert.equal(ready.status, 200);
      assert.equal(ready.body.database, "ok");
      assert.equal(ready.body.openClawConfigured, true);
    });
  } finally {
    config.openClawApiToken = originalToken;
  }
});

test("storage debug endpoint reports database and JSON locations", async () => {
  const db = tempDb();
  const app = createApp({ db, botController: null });
  await withServer(app, async (baseUrl) => {
    const { status, body } = await requestJson(baseUrl, "/api/debug/storage");

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.dbPath);
    assert.ok(body.jsonDir);
    assert.ok(Number.isInteger(body.projectCount));
  });
});

test("OpenClaw endpoints fail closed without a configured token", async () => {
  const db = tempDb();
  const originalToken = config.openClawApiToken;
  config.openClawApiToken = "";
  const app = createApp({ db, botController: null });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await requestJson(baseUrl, "/internal/openclaw/reconcileMissedSchedules", {
        method: "POST",
        body: "{}"
      });

      assert.equal(response.status, 503);
      assert.match(response.body.error, /not configured/);
    });
  } finally {
    config.openClawApiToken = originalToken;
  }
});

test("OpenClaw endpoints require bearer auth and validate command payloads", async () => {
  const db = tempDb();
  const originalToken = config.openClawApiToken;
  config.openClawApiToken = "test-token";
  const app = createApp({ db, botController: null });

  try {
    await withServer(app, async (baseUrl) => {
      const unauthorized = await requestJson(baseUrl, "/internal/openclaw/reconcileMissedSchedules", {
        method: "POST",
        body: "{}"
      });
      const badProject = await requestJson(baseUrl, "/internal/openclaw/checkCompletion", {
        method: "POST",
        headers: { authorization: "Bearer test-token" },
        body: "{}"
      });
      const notify = await requestJson(baseUrl, "/internal/openclaw/notifyLead", {
        method: "POST",
        headers: { authorization: "Bearer test-token" },
        body: JSON.stringify({ message: "Ping" })
      });

      assert.equal(unauthorized.status, 401);
      assert.equal(badProject.status, 400);
      assert.equal(notify.status, 200);
      assert.equal(notify.body.ok, true);
    });
  } finally {
    config.openClawApiToken = originalToken;
  }
});
