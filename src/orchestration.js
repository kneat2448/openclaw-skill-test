const config = require("./config");
const dbApi = require("./db");
const analysis = require("./analysis");

function createOrchestration({ db, notifier = null }) {
  async function notifyLead(message) {
    if (notifier?.notifyLead) await notifier.notifyLead(message);
    return { ok: true, message };
  }

  async function createWorkflow(projectId) {
    const project = dbApi.getProject(db, projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const workflow = dbApi.registerWorkflow(db, projectId, project.schedule_at, {
      automationLayer: "openclaw",
      reviewCadence: project.reviewCadence,
      commands: ["startReviewRound", "sendReminder", "checkCompletion", "runAnalysis", "notifyLead"]
    });
    return { ok: true, workflow };
  }

  async function startReviewRound(projectId) {
    const project = dbApi.getProject(db, projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    dbApi.generateAssignments(db, projectId);
    dbApi.setProjectStatus(db, projectId, "collecting");
    if (notifier?.sendReviewInvites) {
      await notifier.sendReviewInvites(projectId);
    }
    return { ok: true, projectId, completion: dbApi.getCompletion(db, projectId) };
  }

  async function sendReminder(projectId) {
    const assignments = dbApi.getAssignments(db, projectId)
      .filter((assignment) => ["pending", "in_progress", "needs_fix"].includes(assignment.status));
    if (notifier?.sendReminder) {
      for (const assignment of assignments) {
        await notifier.sendReminder(assignment);
      }
    }
    return { ok: true, projectId, reminded: assignments.length };
  }

  async function checkCompletion(projectId) {
    const completion = dbApi.getCompletion(db, projectId);
    if (completion.complete) {
      dbApi.setProjectStatus(db, projectId, "complete");
      if (config.autoAnalyzeOnComplete) {
        const dashboard = analysis.writeDashboard(db, projectId);
        return { ok: true, projectId, completion, analyzed: true, dashboard };
      }
    }
    return { ok: true, projectId, completion, analyzed: false };
  }

  async function runAnalysis(projectId) {
    const dashboard = analysis.writeDashboard(db, projectId);
    return { ok: true, projectId, dashboardUrl: `${config.baseUrl}/dashboard/${projectId}`, dashboard };
  }

  async function pauseReview(projectId) {
    dbApi.setProjectStatus(db, projectId, "paused");
    return { ok: true, projectId };
  }

  async function resumeReview(projectId) {
    dbApi.setProjectStatus(db, projectId, "collecting");
    return { ok: true, projectId };
  }

  async function reconcileMissedSchedules(now = new Date()) {
    const due = db.prepare(`
      SELECT p.id
      FROM projects p
      JOIN openclaw_workflows w ON w.project_id = p.id
      WHERE p.status = 'scheduled'
        AND w.next_run_at IS NOT NULL
        AND w.next_run_at <= ?
    `).all(now.toISOString());
    for (const row of due) {
      await startReviewRound(row.id);
    }
    return { ok: true, started: due.map((row) => row.id) };
  }

  return {
    createWorkflow,
    startReviewRound,
    sendReminder,
    checkCompletion,
    runAnalysis,
    notifyLead,
    pauseReview,
    resumeReview,
    reconcileMissedSchedules
  };
}

module.exports = { createOrchestration };
