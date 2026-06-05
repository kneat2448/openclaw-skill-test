const express = require("express");
const path = require("path");
const config = require("./config");
const dbApi = require("./db");
const { createBot } = require("./bot");
const { createOrchestration } = require("./orchestration");
const analysis = require("./analysis");

function requireOpenClawToken(req, res, next) {
  if (!config.openClawApiToken) return next();
  const header = req.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (token !== config.openClawApiToken) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  return next();
}

function createApp({ db, botController }) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const orchestration = createOrchestration({ db, notifier: botController });

  app.get("/", (req, res) => {
    res.json({ ok: true, app: "peer-review-workflow" });
  });

  app.get("/dashboard", (req, res) => {
    res.sendFile(path.join(config.rootDir, "dashboard", "index.html"));
  });

  app.get("/dashboard/:projectId", (req, res) => {
    res.sendFile(path.join(config.rootDir, "dashboard", "index.html"));
  });

  app.use("/data", express.static(path.join(config.rootDir, "dashboard", "public", "data")));

  app.get("/api/projects", (req, res) => {
    res.json({ ok: true, projects: dbApi.listProjects(db) });
  });

  app.get("/api/projects/:projectId/status", (req, res) => {
    res.json({ ok: true, completion: dbApi.getCompletion(db, Number(req.params.projectId)) });
  });

  app.get("/api/projects/:projectId/dashboard", (req, res) => {
    try {
      const dashboard = analysis.buildDashboard(db, Number(req.params.projectId));
      res.json({ ok: true, dashboard });
    } catch (error) {
      res.status(404).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/projects/:projectId/analyze", (req, res) => {
    try {
      const dashboard = analysis.writeDashboard(db, Number(req.params.projectId));
      res.json({ ok: true, dashboard });
    } catch (error) {
      res.status(404).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/projects/:projectId/export", (req, res) => {
    res.json({ ok: true, reviews: analysis.exportAnonymousReviews(db, Number(req.params.projectId)) });
  });

  app.post("/internal/openclaw/:command", requireOpenClawToken, async (req, res) => {
    try {
      const command = req.params.command;
      const projectId = req.body.projectId ? Number(req.body.projectId) : null;
      if (!orchestration[command]) return res.status(404).json({ ok: false, error: "Unknown command" });
      const result = command === "notifyLead"
        ? await orchestration.notifyLead(req.body.message || "")
        : command === "reconcileMissedSchedules"
          ? await orchestration.reconcileMissedSchedules()
        : await orchestration[command](projectId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.locals.orchestration = orchestration;
  return app;
}

async function main() {
  const db = dbApi.openDatabase();
  const botController = createBot({ db });
  const app = createApp({ db, botController });
  await app.locals.orchestration.reconcileMissedSchedules();
  app.listen(config.port, () => {
    console.log(`Peer review workflow listening on ${config.port}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { createApp };
