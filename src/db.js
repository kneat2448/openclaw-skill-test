const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const config = require("./config");
const { DEFAULT_QUESTIONS } = require("./questions");

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function openDatabase(dbPath = config.dbPath) {
  ensureDir(dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      review_goal TEXT DEFAULT '',
      schedule_at TEXT,
      review_cadence TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      question_template TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_sensitive_data (
      project_id INTEGER PRIMARY KEY,
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT '',
      telegram_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_setup_sessions (
      telegram_user_id TEXT PRIMARY KEY,
      step TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS openclaw_workflows (
      project_id INTEGER PRIMARY KEY,
      workflow_key TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'registered',
      next_run_at TEXT,
      last_run_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS review_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      reviewer_member_id INTEGER NOT NULL,
      reviewee_member_id INTEGER NOT NULL,
      delivery_user_id TEXT,
      proxy_delivery INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      reminder_due_at TEXT,
      sent_at TEXT,
      submitted_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, reviewer_member_id, reviewee_member_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(reviewer_member_id) REFERENCES team_members(id) ON DELETE CASCADE,
      FOREIGN KEY(reviewee_member_id) REFERENCES team_members(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL UNIQUE,
      project_id INTEGER NOT NULL,
      reviewer_member_id INTEGER NOT NULL,
      reviewee_member_id INTEGER NOT NULL,
      scores TEXT NOT NULL,
      strengths TEXT DEFAULT '',
      concerns TEXT DEFAULT '',
      recommendation TEXT DEFAULT '',
      submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(assignment_id) REFERENCES review_assignments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS results (
      project_id INTEGER PRIMARY KEY,
      dashboard_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS review_send_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      assignment_id INTEGER,
      recipient_user_id TEXT,
      ok INTEGER NOT NULL,
      message TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const columns = db.prepare("PRAGMA table_info(projects)").all().map((column) => column.name);
  if (!columns.includes("review_cadence")) {
    db.prepare("ALTER TABLE projects ADD COLUMN review_cadence TEXT DEFAULT '{}'").run();
  }
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function saveSetupSession(db, telegramUserId, step, payload) {
  db.prepare(`
    INSERT INTO project_setup_sessions (telegram_user_id, step, payload, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      step = excluded.step,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `).run(String(telegramUserId), step, JSON.stringify(payload), nowIso());
}

function getSetupSession(db, telegramUserId) {
  const row = db.prepare("SELECT * FROM project_setup_sessions WHERE telegram_user_id = ?").get(String(telegramUserId));
  if (!row) return null;
  return { step: row.step, payload: parseJson(row.payload, {}) };
}

function clearSetupSession(db, telegramUserId) {
  db.prepare("DELETE FROM project_setup_sessions WHERE telegram_user_id = ?").run(String(telegramUserId));
}

function createProject(db, input) {
  const questions = input.questions?.length ? input.questions : DEFAULT_QUESTIONS;
  const roster = input.roster || [];
  const reviewCadence = input.reviewCadence || {
    cadence: "end",
    startAt: new Date().toISOString(),
    endAt: input.scheduleAt || null,
    reviewDates: input.scheduleAt ? [input.scheduleAt] : [],
    nextReviewAt: input.scheduleAt || null
  };
  const nextReviewAt = reviewCadence.nextReviewAt || input.scheduleAt || null;
  const create = db.transaction(() => {
    const project = db.prepare(`
      INSERT INTO projects (name, description, review_goal, schedule_at, review_cadence, status, question_template, updated_at)
      VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)
    `).run(input.name, input.description || "", input.reviewGoal || "", nextReviewAt, JSON.stringify(reviewCadence), JSON.stringify(questions), nowIso());
    const projectId = project.lastInsertRowid;
    db.prepare("INSERT INTO project_sensitive_data (project_id, notes) VALUES (?, ?)").run(projectId, input.sensitiveNotes || "");
    const insertMember = db.prepare(`
      INSERT INTO team_members (project_id, name, role, telegram_user_id)
      VALUES (?, ?, ?, ?)
    `);
    for (const member of roster) {
      insertMember.run(projectId, member.name, member.role || "", member.telegramUserId ? String(member.telegramUserId) : null);
    }
    registerWorkflow(db, projectId, nextReviewAt, { reviewCadence });
    generateAssignments(db, projectId);
    return projectId;
  });
  return create();
}

function registerWorkflow(db, projectId, nextRunAt = null, metadata = {}) {
  const workflowKey = `peer-review:${projectId}`;
  db.prepare(`
    INSERT INTO openclaw_workflows (project_id, workflow_key, state, next_run_at, metadata, updated_at)
    VALUES (?, ?, 'registered', ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      workflow_key = excluded.workflow_key,
      next_run_at = excluded.next_run_at,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
  `).run(projectId, workflowKey, nextRunAt, JSON.stringify(metadata), nowIso());
  return { projectId, workflowKey, nextRunAt };
}

function generateAssignments(db, projectId) {
  const members = db.prepare("SELECT * FROM team_members WHERE project_id = ? ORDER BY id").all(projectId);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO review_assignments
      (project_id, reviewer_member_id, reviewee_member_id, delivery_user_id, proxy_delivery)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const reviewer of members) {
      for (const reviewee of members) {
        if (reviewer.id === reviewee.id) continue;
        const proxy = reviewer.telegram_user_id ? 0 : 1;
        insert.run(projectId, reviewer.id, reviewee.id, reviewer.telegram_user_id || config.techLeadUserId || null, proxy);
      }
    }
  });
  tx();
  return getAssignments(db, projectId);
}

function getProject(db, projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return null;
  return {
    ...project,
    questionTemplate: parseJson(project.question_template, DEFAULT_QUESTIONS),
    reviewCadence: parseJson(project.review_cadence, {})
  };
}

function listProjects(db) {
  return db.prepare("SELECT id, name, status, schedule_at FROM projects ORDER BY id DESC").all();
}

function findProject(db, selector) {
  if (!selector) return db.prepare("SELECT * FROM projects ORDER BY id DESC LIMIT 1").get();
  const trimmed = String(selector).trim();
  if (/^\d+$/.test(trimmed)) return db.prepare("SELECT * FROM projects WHERE id = ?").get(Number(trimmed));
  return db.prepare("SELECT * FROM projects WHERE lower(name) LIKE lower(?) ORDER BY id DESC LIMIT 1").get(`%${trimmed}%`);
}

function getMembers(db, projectId) {
  return db.prepare("SELECT * FROM team_members WHERE project_id = ? ORDER BY id").all(projectId);
}

function getAssignments(db, projectId) {
  return db.prepare(`
    SELECT a.*, reviewer.name AS reviewer_name, reviewee.name AS reviewee_name
    FROM review_assignments a
    JOIN team_members reviewer ON reviewer.id = a.reviewer_member_id
    JOIN team_members reviewee ON reviewee.id = a.reviewee_member_id
    WHERE a.project_id = ?
    ORDER BY reviewer.name, reviewee.name
  `).all(projectId);
}

function getAssignmentsForDeliveryUser(db, deliveryUserId) {
  return db.prepare(`
    SELECT a.*, p.name AS project_name, reviewer.name AS reviewer_name, reviewee.name AS reviewee_name
    FROM review_assignments a
    JOIN projects p ON p.id = a.project_id
    JOIN team_members reviewer ON reviewer.id = a.reviewer_member_id
    JOIN team_members reviewee ON reviewee.id = a.reviewee_member_id
    WHERE a.delivery_user_id = ? AND a.status IN ('pending', 'in_progress', 'needs_fix')
    ORDER BY a.project_id, a.id
  `).all(String(deliveryUserId));
}

function markAssignmentSent(db, assignmentId, reminderDueAt = null) {
  db.prepare(`
    UPDATE review_assignments
    SET status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END,
        sent_at = COALESCE(sent_at, ?),
        reminder_due_at = ?,
        updated_at = ?
    WHERE id = ? AND status != 'submitted'
  `).run(nowIso(), reminderDueAt, nowIso(), assignmentId);
}

function markAssignmentFailed(db, assignmentId, message) {
  db.prepare("UPDATE review_assignments SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?")
    .run(message, nowIso(), assignmentId);
}

function setProjectStatus(db, projectId, status) {
  db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), projectId);
}

function saveResponse(db, assignmentId, parsed) {
  const assignment = db.prepare("SELECT * FROM review_assignments WHERE id = ?").get(assignmentId);
  if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
  if (assignment.status === "submitted") throw new Error("Assignment already submitted");
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO responses
        (assignment_id, project_id, reviewer_member_id, reviewee_member_id, scores, strengths, concerns, recommendation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assignment.id,
      assignment.project_id,
      assignment.reviewer_member_id,
      assignment.reviewee_member_id,
      JSON.stringify(parsed.scores),
      parsed.strengths || "",
      parsed.concerns || "",
      parsed.recommendation || ""
    );
    db.prepare("UPDATE review_assignments SET status = 'submitted', submitted_at = ?, updated_at = ? WHERE id = ?")
      .run(nowIso(), nowIso(), assignment.id);
  });
  tx();
}

function getResponses(db, projectId) {
  return db.prepare(`
    SELECT r.*, reviewer.name AS reviewer_name, reviewee.name AS reviewee_name
    FROM responses r
    JOIN team_members reviewer ON reviewer.id = r.reviewer_member_id
    JOIN team_members reviewee ON reviewee.id = r.reviewee_member_id
    WHERE r.project_id = ?
  `).all(projectId).map((row) => ({ ...row, scores: parseJson(row.scores, []) }));
}

function getCompletion(db, projectId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted,
      SUM(CASE WHEN status IN ('pending', 'in_progress', 'needs_fix') THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM review_assignments
    WHERE project_id = ?
  `).get(projectId);
  return {
    total: row.total || 0,
    submitted: row.submitted || 0,
    open: row.open || 0,
    failed: row.failed || 0,
    complete: (row.total || 0) > 0 && (row.submitted || 0) === (row.total || 0)
  };
}

function saveResult(db, projectId, dashboard) {
  db.prepare(`
    INSERT INTO results (project_id, dashboard_json, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      dashboard_json = excluded.dashboard_json,
      created_at = excluded.created_at
  `).run(projectId, JSON.stringify(dashboard, null, 2), nowIso());
}

function logSend(db, projectId, assignmentId, recipientUserId, ok, message = "") {
  db.prepare(`
    INSERT INTO review_send_log (project_id, assignment_id, recipient_user_id, ok, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(projectId, assignmentId, recipientUserId ? String(recipientUserId) : null, ok ? 1 : 0, message);
}

module.exports = {
  openDatabase,
  migrate,
  nowIso,
  parseJson,
  saveSetupSession,
  getSetupSession,
  clearSetupSession,
  createProject,
  registerWorkflow,
  generateAssignments,
  getProject,
  listProjects,
  findProject,
  getMembers,
  getAssignments,
  getAssignmentsForDeliveryUser,
  markAssignmentSent,
  markAssignmentFailed,
  setProjectStatus,
  saveResponse,
  getResponses,
  getCompletion,
  saveResult,
  logSend
};
