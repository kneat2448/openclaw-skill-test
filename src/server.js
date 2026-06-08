const express = require("express");
const path = require("path");
const config = require("./config");
const dbApi = require("./db");
const { createBot } = require("./bot");
const { createOrchestration } = require("./orchestration");
const analysis = require("./analysis");
const jsonStore = require("./jsonStore");

const OPENCLAW_PROJECT_COMMANDS = new Set([
  "createWorkflow",
  "startReviewRound",
  "sendReminder",
  "checkCompletion",
  "runAnalysis",
  "pauseReview",
  "resumeReview"
]);
const OPENCLAW_GLOBAL_COMMANDS = new Set(["notifyLead", "reconcileMissedSchedules"]);
const OPENCLAW_COMMANDS = new Set([...OPENCLAW_PROJECT_COMMANDS, ...OPENCLAW_GLOBAL_COMMANDS]);

function requireOpenClawToken(req, res, next) {
  if (!config.openClawApiToken || config.openClawApiToken === "change-me") {
    return res.status(503).json({ ok: false, error: "OpenClaw token is not configured" });
  }
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

  app.get("/health", (req, res) => {
    res.json({ ok: true, app: "peer-review-workflow" });
  });

  app.get("/ready", (req, res) => {
    try {
      db.prepare("SELECT 1").get();
      const openClawConfigured = Boolean(config.openClawApiToken && config.openClawApiToken !== "change-me");
      res.status(openClawConfigured ? 200 : 503).json({
        ok: openClawConfigured,
        database: "ok",
        openClawConfigured
      });
    } catch (error) {
      res.status(503).json({ ok: false, database: "error", error: error.message });
    }
  });

  app.get("/dashboard", (req, res) => {
    res.sendFile(path.join(config.rootDir, "dashboard", "index.html"));
  });

  app.get("/dashboard/:projectId", (req, res) => {
    res.sendFile(path.join(config.rootDir, "dashboard", "index.html"));
  });

  app.use("/data", express.static(path.join(config.rootDir, "dashboard", "public", "data")));

  app.get("/api/projects", (req, res) => {
    const snapshotProjects = jsonStore.listProjectSnapshots();
    const dashboardProjects = jsonStore.listDashboardProjects();
    try {
      const projects = dbApi.listProjects(db);
      jsonStore.syncProjectsIndex(db);
      res.json({
        ok: true,
        source: "merged",
        projects: jsonStore.mergeProjects(projects, snapshotProjects, dashboardProjects)
      });
    } catch (error) {
      res.json({
        ok: true,
        source: "json-fallback",
        projects: jsonStore.mergeProjects(snapshotProjects, dashboardProjects)
      });
    }
  });

  app.get("/api/projects/:projectId/status", (req, res) => {
    res.json({ ok: true, completion: dbApi.getCompletion(db, Number(req.params.projectId)) });
  });

  app.get("/api/dashboard/latest", (req, res) => {
    try {
      const project = dbApi.findProject(db);
      if (!project) return res.status(404).json({ ok: false, error: "No projects found" });
      const dashboard = analysis.getDashboard(db, project.id);
      res.json({ ok: true, dashboard });
    } catch (error) {
      res.status(404).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/projects/:projectId/dashboard", (req, res) => {
    try {
      const dashboard = analysis.getDashboard(db, Number(req.params.projectId));
      res.json({ ok: true, dashboard });
    } catch (error) {
      res.status(404).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/projects/:projectId/snapshot", (req, res) => {
    const projectId = Number(req.params.projectId);
    const snapshot = jsonStore.readProjectSnapshot(projectId) || jsonStore.syncProject(db, projectId);
    if (!snapshot) return res.status(404).json({ ok: false, error: `Project ${projectId} not found` });
    res.json({ ok: true, snapshot });
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
      if (!OPENCLAW_COMMANDS.has(command)) return res.status(404).json({ ok: false, error: "Unknown command" });

      let result;
      if (OPENCLAW_PROJECT_COMMANDS.has(command)) {
        const projectId = Number(req.body?.projectId);
        if (!Number.isInteger(projectId) || projectId <= 0) {
          return res.status(400).json({ ok: false, error: "projectId must be a positive integer" });
        }
        result = await orchestration[command](projectId);
      } else if (command === "notifyLead") {
        const message = String(req.body?.message || "").trim();
        if (!message) return res.status(400).json({ ok: false, error: "message is required" });
        result = await orchestration.notifyLead(message);
      } else {
        result = await orchestration.reconcileMissedSchedules();
      }
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
