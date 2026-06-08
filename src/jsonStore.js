const fs = require("fs");
const path = require("path");
const config = require("./config");

function jsonRoot() {
  return path.join(config.rootDir, "data", "json");
}

function dashboardDataRoot() {
  return path.join(config.rootDir, "dashboard", "public", "data");
}

function ensureDirs() {
  fs.mkdirSync(jsonRoot(), { recursive: true });
  fs.mkdirSync(dashboardDataRoot(), { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDirs();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function projectFile(projectId) {
  return path.join(jsonRoot(), `project-${projectId}.json`);
}

function dashboardFile(projectId) {
  return path.join(dashboardDataRoot(), `${projectId}.json`);
}

function syncProjectsIndex(db) {
  const projects = db.prepare(`
    SELECT id, name, status, schedule_at, review_cadence, created_at, updated_at
    FROM projects
    ORDER BY id DESC
  `).all().map((project) => ({
    ...project,
    reviewCadence: parseJson(project.review_cadence, {})
  }));
  writeJson(path.join(jsonRoot(), "projects.json"), { updatedAt: new Date().toISOString(), projects });
  return projects;
}

function syncProject(db, projectId) {
  const snapshot = buildProjectSnapshot(db, projectId);
  if (!snapshot) return null;
  writeJson(projectFile(projectId), snapshot);
  syncProjectsIndex(db);
  return snapshot;
}

function buildProjectSnapshot(db, projectId) {
  const project = db.prepare(`
    SELECT id, name, description, review_goal, schedule_at, review_cadence, status, question_template, created_at, updated_at
    FROM projects
    WHERE id = ?
  `).get(projectId);
  if (!project) return null;

  const members = db.prepare("SELECT * FROM team_members WHERE project_id = ? ORDER BY id").all(projectId);
  const assignments = db.prepare(`
    SELECT a.*, reviewer.name AS reviewer_name, reviewee.name AS reviewee_name
    FROM review_assignments a
    JOIN team_members reviewer ON reviewer.id = a.reviewer_member_id
    JOIN team_members reviewee ON reviewee.id = a.reviewee_member_id
    WHERE a.project_id = ?
    ORDER BY a.id
  `).all(projectId);
  const responses = db.prepare(`
    SELECT r.*, reviewer.name AS reviewer_name, reviewee.name AS reviewee_name
    FROM responses r
    JOIN team_members reviewer ON reviewer.id = r.reviewer_member_id
    JOIN team_members reviewee ON reviewee.id = r.reviewee_member_id
    WHERE r.project_id = ?
    ORDER BY r.id
  `).all(projectId).map((response) => ({
    ...response,
    scores: parseJson(response.scores, [])
  }));
  const completion = getCompletionFromAssignments(assignments);

  return {
    updatedAt: new Date().toISOString(),
    project: {
      ...project,
      reviewCadence: parseJson(project.review_cadence, {}),
      questionTemplate: parseJson(project.question_template, [])
    },
    members,
    assignments,
    responses,
    completion
  };
}

function listProjectSnapshots() {
  const index = readJson(path.join(jsonRoot(), "projects.json"), { projects: [] });
  return index.projects || [];
}

function readProjectSnapshot(projectId) {
  return readJson(projectFile(projectId), null);
}

function writeDashboardJson(projectId, dashboard) {
  writeJson(dashboardFile(projectId), dashboard);
}

function readDashboardJson(projectId) {
  return readJson(dashboardFile(projectId), null);
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getCompletionFromAssignments(assignments) {
  const total = assignments.length;
  const submitted = assignments.filter((assignment) => assignment.status === "submitted").length;
  const open = assignments.filter((assignment) => ["pending", "in_progress", "needs_fix"].includes(assignment.status)).length;
  const failed = assignments.filter((assignment) => assignment.status === "failed").length;
  return {
    total,
    submitted,
    open,
    failed,
    complete: total > 0 && submitted === total
  };
}

module.exports = {
  jsonRoot,
  dashboardDataRoot,
  syncProjectsIndex,
  syncProject,
  buildProjectSnapshot,
  listProjectSnapshots,
  readProjectSnapshot,
  writeDashboardJson,
  readDashboardJson
};
