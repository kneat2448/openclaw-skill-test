const config = require("./config");
const dbApi = require("./db");
const analysis = require("./analysis");
const { DEFAULT_QUESTIONS } = require("./questions");
const {
  parseReviewMessage,
  formatReviewTemplate,
  formatValidationError
} = require("./reviewParser");

const SETUP_STEPS = [
  "name",
  "description",
  "reviewGoal",
  "roster",
  "scheduleAt",
  "questions",
  "sensitiveNotes",
  "confirm"
];

function isTechLead(userId) {
  return String(userId) === config.techLeadUserId;
}

function createBot({ db, telegramBot = null }) {
  const bot = telegramBot || (config.telegramBotToken
    ? new TelegramClient(config.telegramBotToken)
    : null);

  async function sendMessage(chatId, text, options) {
    if (!bot) {
      console.log(`[telegram disabled] -> ${chatId}\n${text}`);
      return null;
    }
    return bot.sendMessage(chatId, text, options);
  }

  async function notifyLead(message) {
    if (!config.techLeadUserId) return;
    await sendMessage(config.techLeadUserId, message);
  }

  async function sendReviewInvites(projectId) {
    const project = dbApi.getProject(db, projectId);
    const assignments = dbApi.getAssignments(db, projectId);
    const byDeliveryUser = new Map();
    for (const assignment of assignments) {
      if (assignment.status === "submitted") continue;
      if (!assignment.delivery_user_id) {
        dbApi.markAssignmentFailed(db, assignment.id, "No Telegram user ID available");
        continue;
      }
      if (!byDeliveryUser.has(assignment.delivery_user_id)) byDeliveryUser.set(assignment.delivery_user_id, []);
      byDeliveryUser.get(assignment.delivery_user_id).push(assignment);
    }

    for (const [deliveryUserId, userAssignments] of byDeliveryUser.entries()) {
      const first = userAssignments[0];
      const reviewees = userAssignments.map((assignment) => assignment.reviewee_name).join(", ");
      const proxyNote = first.proxy_delivery
        ? `\n\nProxy delivery: ${first.reviewer_name} has no Telegram ID, so this was routed to the tech lead.`
        : "";
      const text = [
        `Peer review started: ${project.name}`,
        `Reviewer: ${first.reviewer_name}`,
        `Review these teammates: ${reviewees}`,
        "",
        "Send one review per teammate. Start with the first template below.",
        "",
        formatReviewTemplate(first, project.questionTemplate),
        proxyNote
      ].join("\n");
      try {
        await sendMessage(deliveryUserId, text);
        for (const assignment of userAssignments) {
          dbApi.markAssignmentSent(db, assignment.id, new Date(Date.now() + config.laterRemindMs).toISOString());
          dbApi.logSend(db, projectId, assignment.id, deliveryUserId, true, "sent");
        }
      } catch (error) {
        for (const assignment of userAssignments) {
          dbApi.markAssignmentFailed(db, assignment.id, error.message);
          dbApi.logSend(db, projectId, assignment.id, deliveryUserId, false, error.message);
        }
        await notifyLead(`Could not reach ${first.reviewer_name}: ${error.message}`);
      }
    }
  }

  async function sendReminder(assignment) {
    await sendMessage(
      assignment.delivery_user_id,
      `Reminder: please submit your review for ${assignment.reviewee_name}.\n\n${formatReviewTemplate(assignment)}`
    );
  }

  async function handleText(msg) {
    const userId = String(msg.from.id);
    const text = String(msg.text || "").trim();
    if (!text) return;

    if (text === "/start" || text === "/help") {
      await sendMessage(msg.chat.id, helpText());
      return;
    }

    if (isTechLead(userId)) {
      const handled = await handleTechLead(msg, text);
      if (handled) return;
    }

    await handleReviewerMessage(msg, text);
  }

  async function handleTechLead(msg, text) {
    const lower = text.toLowerCase();
    const activeSetup = dbApi.getSetupSession(db, msg.from.id);

    if (lower === "create project") {
      dbApi.saveSetupSession(db, msg.from.id, "name", {});
      await sendMessage(msg.chat.id, "Project name?");
      return true;
    }

    if (activeSetup) {
      await advanceSetup(msg, text, activeSetup);
      return true;
    }

    if (lower === "projects") {
      const projects = dbApi.listProjects(db);
      await sendMessage(msg.chat.id, projects.length
        ? projects.map((project, index) => `${index + 1}. #${project.id} ${project.name} (${project.status})`).join("\n")
        : "No projects yet.");
      return true;
    }

    const commandMatch = text.match(/^(start review|pause review|resume review|send reminder|analyze reviews|dashboard|status|export reviews)(?:\s+(.+))?$/i);
    if (!commandMatch) return false;

    const command = commandMatch[1].toLowerCase();
    const project = dbApi.findProject(db, commandMatch[2]);
    if (!project) {
      await sendMessage(msg.chat.id, "Project not found.");
      return true;
    }

    if (command === "start review") {
      dbApi.setProjectStatus(db, project.id, "collecting");
      await sendReviewInvites(project.id);
      await sendMessage(msg.chat.id, `Review round started for ${project.name}.`);
    } else if (command === "pause review") {
      dbApi.setProjectStatus(db, project.id, "paused");
      await sendMessage(msg.chat.id, `Paused ${project.name}.`);
    } else if (command === "resume review") {
      dbApi.setProjectStatus(db, project.id, "collecting");
      await sendMessage(msg.chat.id, `Resumed ${project.name}.`);
    } else if (command === "send reminder") {
      const open = dbApi.getAssignments(db, project.id).filter((assignment) => assignment.status !== "submitted");
      for (const assignment of open) await sendReminder(assignment);
      await sendMessage(msg.chat.id, `Sent ${open.length} reminders.`);
    } else if (command === "analyze reviews") {
      analysis.writeDashboard(db, project.id);
      await sendMessage(msg.chat.id, `Analysis complete: ${config.baseUrl}/dashboard/${project.id}`);
    } else if (command === "dashboard") {
      await sendMessage(msg.chat.id, `${config.baseUrl}/dashboard/${project.id}`);
    } else if (command === "status") {
      await sendMessage(msg.chat.id, formatStatus(db, project.id));
    } else if (command === "export reviews") {
      const exported = analysis.exportAnonymousReviews(db, project.id);
      await sendMessage(msg.chat.id, JSON.stringify(exported, null, 2).slice(0, 3900));
    }
    return true;
  }

  async function advanceSetup(msg, text, session) {
    const payload = session.payload;
    const step = session.step;

    if (step === "confirm") {
      if (!/^yes$/i.test(text)) {
        dbApi.clearSetupSession(db, msg.from.id);
        await sendMessage(msg.chat.id, "Project setup cancelled.");
        return;
      }
      const projectId = dbApi.createProject(db, payload);
      dbApi.clearSetupSession(db, msg.from.id);
      await sendMessage(msg.chat.id, `Project #${projectId} created and registered for OpenClaw orchestration.`);
      return;
    }

    const nextPayload = { ...payload };
    if (step === "roster") {
      nextPayload.roster = parseRoster(text);
      if (nextPayload.roster.length < 2) {
        await sendMessage(msg.chat.id, "Please provide at least two teammates, one per line. Example: Priya | Engineer | 123456");
        return;
      }
    } else if (step === "questions") {
      nextPayload.questions = /^default$/i.test(text)
        ? DEFAULT_QUESTIONS
        : text.split(/\n+/).map((line) => line.replace(/^\d+[\).:-]\s*/, "").trim()).filter(Boolean);
      if (nextPayload.questions.length !== 15) {
        await sendMessage(msg.chat.id, "Please send exactly 15 questions, or type `default`.");
        return;
      }
    } else if (step === "scheduleAt") {
      nextPayload.scheduleAt = parseSchedule(text);
      if (!nextPayload.scheduleAt) {
        await sendMessage(msg.chat.id, "Please send an ISO date/time like 2026-06-06T10:00:00+05:30, or type `now`.");
        return;
      }
    } else {
      nextPayload[step] = text;
    }

    const nextStep = SETUP_STEPS[SETUP_STEPS.indexOf(step) + 1];
    if (nextStep === "confirm") {
      dbApi.saveSetupSession(db, msg.from.id, "confirm", nextPayload);
      await sendMessage(msg.chat.id, `${formatProjectPreview(nextPayload)}\n\nType yes to create this project, or anything else to cancel.`);
      return;
    }
    dbApi.saveSetupSession(db, msg.from.id, nextStep, nextPayload);
    await sendMessage(msg.chat.id, promptForStep(nextStep));
  }

  async function handleReviewerMessage(msg, text) {
    const assignments = dbApi.getAssignmentsForDeliveryUser(db, msg.from.id);
    if (!assignments.length) {
      await sendMessage(msg.chat.id, "No open peer reviews found for you.");
      return;
    }
    const assignment = assignments[0];
    const project = dbApi.getProject(db, assignment.project_id);
    const parsed = parseReviewMessage(text, project.questionTemplate.length);
    if (!parsed.ok) {
      db.prepare("UPDATE review_assignments SET status = 'needs_fix', updated_at = ? WHERE id = ?")
        .run(dbApi.nowIso(), assignment.id);
      await sendMessage(msg.chat.id, formatValidationError(parsed, assignment, project.questionTemplate));
      return;
    }

    dbApi.saveResponse(db, assignment.id, parsed);
    const remaining = dbApi.getAssignmentsForDeliveryUser(db, msg.from.id)
      .filter((item) => item.project_id === assignment.project_id);
    const completion = dbApi.getCompletion(db, assignment.project_id);
    const submittedByReviewer = db.prepare(`
      SELECT COUNT(*) AS count
      FROM review_assignments
      WHERE project_id = ? AND reviewer_member_id = ? AND status = 'submitted'
    `).get(assignment.project_id, assignment.reviewer_member_id).count;
    const totalByReviewer = db.prepare(`
      SELECT COUNT(*) AS count
      FROM review_assignments
      WHERE project_id = ? AND reviewer_member_id = ?
    `).get(assignment.project_id, assignment.reviewer_member_id).count;

    if (remaining.length) {
      await sendMessage(
        msg.chat.id,
        `Stored. Progress: ${submittedByReviewer}/${totalByReviewer} teammates reviewed.\n\nNext:\n${formatReviewTemplate(remaining[0], project.questionTemplate)}`
      );
    } else {
      await sendMessage(msg.chat.id, `Stored. Progress: ${submittedByReviewer}/${totalByReviewer} teammates reviewed. You are done.`);
    }
    if (completion.complete) {
      await notifyLead(`All reviews are complete for ${project.name}. You can run: analyze reviews ${project.id}`);
    }
  }

  if (bot) {
    bot.on("message", (msg) => {
      handleText(msg).catch((error) => {
        console.error(error);
        if (msg.chat?.id) sendMessage(msg.chat.id, `Something went wrong: ${error.message}`).catch(console.error);
      });
    });
  }

  return {
    bot,
    handleText,
    notifyLead,
    sendReviewInvites,
    sendReminder
  };
}

class TelegramClient {
  constructor(token) {
    this.token = token;
    this.offset = 0;
    this.handlers = new Map();
    this.polling = true;
    this.poll().catch((error) => console.error("Telegram polling stopped", error));
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
  }

  async sendMessage(chatId, text, options = {}) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      ...options
    });
  }

  async call(method, body) {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.description || `Telegram ${method} failed`);
    return payload.result;
  }

  async poll() {
    while (this.polling) {
      try {
        const updates = await this.call("getUpdates", {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ["message"]
        });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (update.message) {
            for (const handler of this.handlers.get("message") || []) {
              await handler(update.message);
            }
          }
        }
      } catch (error) {
        console.error("Telegram polling error:", error.message);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
}

function parseRoster(text) {
  return text.split(/\n+/).map((line) => {
    const [name, role, telegramUserId] = line.split("|").map((part) => part?.trim());
    return name ? { name, role: role || "", telegramUserId: telegramUserId || "" } : null;
  }).filter(Boolean);
}

function parseSchedule(text) {
  if (/^now$/i.test(text)) return new Date().toISOString();
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function promptForStep(step) {
  const prompts = {
    description: "Project description/context?",
    reviewGoal: "Review goal?",
    roster: "Team roster, one per line: Name | Role | Telegram user ID. Leave Telegram ID blank if unknown.",
    scheduleAt: "Review launch time? Send ISO date/time like 2026-06-06T10:00:00+05:30, or type `now`.",
    questions: "Send exactly 15 review questions, one per line, or type `default`.",
    sensitiveNotes: "Sensitive notes/contracts/terms? Send `none` if empty."
  };
  return prompts[step] || "Next value?";
}

function formatProjectPreview(payload) {
  return [
    "Project preview",
    `Name: ${payload.name}`,
    `Description: ${payload.description}`,
    `Goal: ${payload.reviewGoal}`,
    `Roster: ${payload.roster.map((member) => member.name).join(", ")}`,
    `Schedule: ${payload.scheduleAt}`,
    `Questions: ${payload.questions.length}`,
    `Sensitive notes: ${payload.sensitiveNotes && !/^none$/i.test(payload.sensitiveNotes) ? "stored separately" : "none"}`
  ].join("\n");
}

function formatStatus(db, projectId) {
  const assignments = dbApi.getAssignments(db, projectId);
  const lines = [`Status for project #${projectId}`];
  for (const assignment of assignments) {
    lines.push(`${assignment.reviewer_name} -> ${assignment.reviewee_name}: ${assignment.status}`);
  }
  return lines.join("\n");
}

function helpText() {
  return [
    "Commands:",
    "create project",
    "projects",
    "start review [project]",
    "pause review [project]",
    "resume review [project]",
    "send reminder [project]",
    "analyze reviews [project]",
    "dashboard [project]",
    "status [project]",
    "export reviews [project]"
  ].join("\n");
}

module.exports = {
  createBot,
  parseRoster,
  parseSchedule,
  formatStatus
};
