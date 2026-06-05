const fs = require("fs");
const path = require("path");
const config = require("./config");
const dbApi = require("./db");

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
  if (values.length < 2) return 0;
  const avg = average(values);
  return average(values.map((value) => (value - avg) ** 2));
}

function riskFor(avg, varianceValue, count) {
  if (!count) return "Unknown";
  if (avg < 5.5 || varianceValue > 5) return "High";
  if (avg < 7 || varianceValue > 3) return "Medium";
  return "Low";
}

function confidenceFor(count, expected) {
  if (!count) return "None";
  const ratio = expected ? count / expected : 0;
  if (ratio >= 0.8) return "High";
  if (ratio >= 0.5) return "Medium";
  return "Low";
}

function summarizeText(responses, field) {
  return responses
    .map((response) => response[field])
    .filter(Boolean)
    .slice(0, 8);
}

function buildDashboard(db, projectId) {
  const project = dbApi.getProject(db, projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const members = dbApi.getMembers(db, projectId);
  const responses = dbApi.getResponses(db, projectId);
  const completion = dbApi.getCompletion(db, projectId);
  const expectedPerMember = Math.max(members.length - 1, 0);

  const teamMatrix = members.map((member) => {
    const received = responses.filter((response) => response.reviewee_member_id === member.id);
    const allScores = received.flatMap((response) => response.scores);
    const avg = average(allScores);
    const varianceValue = variance(allScores);
    return {
      memberId: member.id,
      memberName: member.name,
      responseCount: received.length,
      responseDisplay: received.length ? `${received.length}/${expectedPerMember}` : "No responses",
      average: avg,
      averageDisplay: avg == null ? "No responses" : avg.toFixed(1),
      variance: Number(varianceValue.toFixed(2)),
      confidence: confidenceFor(received.length, expectedPerMember),
      risk: riskFor(avg, varianceValue, received.length)
    };
  });

  const narrative = {
    strengths: summarizeText(responses, "strengths"),
    concerns: summarizeText(responses, "concerns"),
    recurringThemes: inferThemes(responses)
  };

  const decisionScorecard = teamMatrix.map((row) => ({
    memberId: row.memberId,
    memberName: row.memberName,
    readiness: row.average == null ? "Unknown" : row.average >= 8 ? "High" : row.average >= 6.5 ? "Medium" : "Low",
    fit: row.average == null ? "Unknown" : row.average >= 7 ? "Good" : "Needs discussion",
    risk: row.risk,
    note: "Advisory only; use alongside manager judgment and context."
  }));

  return {
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      reviewGoal: project.review_goal,
      status: project.status
    },
    coverage: completion,
    teamMatrix,
    narrative,
    decisionScorecard,
    anonymity: {
      reviewerIdentitiesExposed: false,
      note: "Dashboard aggregates by reviewee and does not expose named reviewer submissions."
    }
  };
}

function inferThemes(responses) {
  const text = responses.map((response) => `${response.strengths} ${response.concerns} ${response.recommendation}`).join(" ").toLowerCase();
  const themes = [];
  for (const term of ["communication", "ownership", "quality", "speed", "collaboration", "leadership", "reliability"]) {
    if (text.includes(term)) themes.push(term);
  }
  return themes;
}

function writeDashboard(db, projectId) {
  const dashboard = buildDashboard(db, projectId);
  const dataDir = path.join(config.rootDir, "dashboard", "public", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${projectId}.json`), JSON.stringify(dashboard, null, 2));
  dbApi.saveResult(db, projectId, dashboard);
  dbApi.setProjectStatus(db, projectId, "analyzed");
  return dashboard;
}

function exportAnonymousReviews(db, projectId) {
  const responses = dbApi.getResponses(db, projectId);
  return responses.map((response) => ({
    revieweeName: response.reviewee_name,
    scores: response.scores,
    strengths: response.strengths,
    concerns: response.concerns,
    recommendation: response.recommendation,
    submittedAt: response.submitted_at
  }));
}

module.exports = {
  buildDashboard,
  writeDashboard,
  exportAnonymousReviews
};
