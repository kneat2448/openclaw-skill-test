const fs = require("fs");
const path = require("path");
const config = require("./config");
const dbApi = require("./db");

const QUESTION_DIMENSIONS = [
  "Reliability",
  "Quality",
  "Ownership",
  "Communication",
  "Collaboration",
  "Judgment",
  "Responsiveness",
  "Problem solving",
  "Adaptability",
  "Leadership",
  "Trust",
  "Impact",
  "Expectation fit",
  "Growth",
  "Overall"
];

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
    const dimensions = QUESTION_DIMENSIONS.map((dimension, index) => {
      const values = received.map((response) => response.scores[index]).filter((score) => Number.isFinite(score));
      const dimensionAverage = average(values);
      return {
        name: dimension,
        average: dimensionAverage,
        averageDisplay: dimensionAverage == null ? "No data" : dimensionAverage.toFixed(1)
      };
    });
    const strongest = dimensions.filter((item) => item.average != null).sort((a, b) => b.average - a.average).slice(0, 3);
    const weakest = dimensions.filter((item) => item.average != null).sort((a, b) => a.average - b.average).slice(0, 3);
    return {
      memberId: member.id,
      memberName: member.name,
      responseCount: received.length,
      responseDisplay: received.length ? `${received.length}/${expectedPerMember}` : "No responses",
      average: avg,
      averageDisplay: avg == null ? "No responses" : avg.toFixed(1),
      variance: Number(varianceValue.toFixed(2)),
      confidence: confidenceFor(received.length, expectedPerMember),
      risk: riskFor(avg, varianceValue, received.length),
      strongestDimensions: strongest,
      growthDimensions: weakest,
      comments: {
        strengths: received.map((response) => response.strengths).filter(Boolean),
        concerns: received.map((response) => response.concerns).filter(Boolean),
        recommendations: received.map((response) => response.recommendation).filter(Boolean)
      }
    };
  });

  const sortedByAverage = teamMatrix
    .filter((row) => row.average != null)
    .sort((a, b) => b.average - a.average);

  const narrative = {
    summary: buildNarrativeSummary(teamMatrix, completion),
    strengths: summarizeText(responses, "strengths"),
    concerns: summarizeText(responses, "concerns"),
    recommendations: summarizeText(responses, "recommendation"),
    recurringThemes: inferThemes(responses),
    outliers: findOutliers(teamMatrix)
  };

  const decisionScorecard = teamMatrix.map((row) => ({
    memberId: row.memberId,
    memberName: row.memberName,
    readiness: row.average == null ? "Unknown" : row.average >= 8 ? "High" : row.average >= 6.5 ? "Medium" : "Low",
    fit: row.average == null ? "Unknown" : row.average >= 7 ? "Good" : "Needs discussion",
    risk: row.risk,
    suggestedAction: suggestedAction(row),
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
    analysis: {
      projectAverage: average(teamMatrix.map((row) => row.average).filter((value) => value != null)),
      topSignals: sortedByAverage.slice(0, 3).map((row) => ({ memberName: row.memberName, average: row.averageDisplay })),
      needsAttention: teamMatrix.filter((row) => ["High", "Medium", "Unknown"].includes(row.risk))
        .map((row) => ({ memberName: row.memberName, risk: row.risk, confidence: row.confidence }))
    },
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
  const terms = ["communication", "ownership", "quality", "speed", "collaboration", "leadership", "reliability", "trust", "impact", "growth"];
  return terms
    .map((term) => ({ theme: term, count: (text.match(new RegExp(term, "g")) || []).length }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((item) => item.theme);
}

function buildNarrativeSummary(teamMatrix, completion) {
  if (!completion.total) return "No review assignments exist yet.";
  if (!completion.submitted) return "Review assignments exist, but no responses have been submitted yet.";
  const covered = teamMatrix.filter((row) => row.responseCount > 0).length;
  const highRisk = teamMatrix.filter((row) => row.risk === "High").length;
  const mediumRisk = teamMatrix.filter((row) => row.risk === "Medium").length;
  return `${completion.submitted}/${completion.total} reviews are submitted across ${covered}/${teamMatrix.length} teammates. ${highRisk} high-risk and ${mediumRisk} medium-risk teammates need follow-up.`;
}

function findOutliers(teamMatrix) {
  const scored = teamMatrix.filter((row) => row.average != null);
  if (scored.length < 2) return [];
  const projectAverage = average(scored.map((row) => row.average));
  return scored
    .filter((row) => Math.abs(row.average - projectAverage) >= 1.5 || row.variance >= 4)
    .map((row) => ({
      memberName: row.memberName,
      averageDisplay: row.averageDisplay,
      variance: row.variance,
      reason: row.variance >= 4 ? "reviewers disagree materially" : "score differs from team average"
    }));
}

function suggestedAction(row) {
  if (row.average == null) return "Collect responses before making a call.";
  if (row.risk === "High") return "Schedule a manager review before any decision.";
  if (row.risk === "Medium") return "Discuss growth areas and validate with context.";
  if (row.average >= 8) return "Recognize strong performance and consider stretch ownership.";
  return "Continue with normal follow-up.";
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
  QUESTION_DIMENSIONS,
  buildDashboard,
  writeDashboard,
  exportAnonymousReviews
};
