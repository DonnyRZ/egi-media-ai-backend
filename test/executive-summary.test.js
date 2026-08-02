const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryIssueStore } = require("../src/issues");
const { InMemoryIssueAnalysisStore } = require("../src/ai/tasks/t07-issue-analysis");
const { InMemoryIssuePriorityStore, T09_PROMPT_VERSION } = require("../src/ai/tasks/t09-priority-enum");
const { ExecutiveSummaryService } = require("../src/dashboard");

const tenantId = "tenant-h";
const companyId = "company-a";
const now = Date.parse("2026-07-22T12:00:00.000Z");

function buildService() {
  let analysisSequence = 0;
  let prioritySequence = 0;
  const issueStore = new InMemoryIssueStore({ now: () => now });
  const analysisStore = new InMemoryIssueAnalysisStore({ uuid: () => `analysis-${++analysisSequence}`, now: () => now });
  const priorityStore = new InMemoryIssuePriorityStore({ uuid: () => `priority-${++prioritySequence}`, now: () => now });

  const addIssue = ({ issueId, priority, observedAt, status = "berkembang", tenant = tenantId, company = companyId, current = true, relevance }) => {
    const analysis = analysisStore.create({
      tenantId: tenant, companyId: company, issueId, contextVersion: 3, inputFingerprint: `fp-${issueId}`, promptVersion: "1.0.0",
      analysis: { what_happened: "x", why_matters: "x", impacts: [], risks: [], watch: [], claims: [{ claim_id: "c1", text: "x", source_article_ids: ["source-1"] }] },
      evidence: [], provenance: {},
    });
    if (current) analysisStore.promoteCurrent({ tenantId: tenant, companyId: company, analysisId: analysis.analysisId, gate: { gateStatus: "passed" } });
    const priorityDecision = priorityStore.create({
      tenantId: tenant, companyId: company, issueId, analysisId: analysis.analysisId, contextVersion: 3, promptVersion: T09_PROMPT_VERSION, priority, provenance: {},
    });
    issueStore.seed({
      issueId, tenantId: tenant, companyId: company, title: `Title ${issueId}`, oneLiner: `One-liner ${issueId}`, status,
      currentPriority: priority, currentPriorityAnalysisId: analysis.analysisId, currentPriorityDecisionId: priorityDecision.priorityDecisionId,
      firstSeenAt: "2026-07-01T12:00:00.000Z", lastDevelopedAt: observedAt, version: 3, closedAt: status === "selesai" ? "2026-07-21T12:00:00.000Z" : null,
      createdAt: "2026-07-01T12:00:00.000Z", updatedAt: observedAt, relevance,
    });
    issueStore.developmentsById.set(`development-${issueId}`, { developmentId: `development-${issueId}`, tenantId: tenant, companyId: company, issueId, observedAt, developmentType: "updated" });
    return { analysis, priorityDecision };
  };
  const service = new ExecutiveSummaryService({
    issueStore, analysisStore, priorityStore, now: () => now,
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "dashboard.executive_summary.read",
  });
  return { service, issueStore, analysisStore, priorityStore, addIssue };
}

test("Executive Summary is a deterministic backend-only Top 20 projection", async () => {
  const { service, addIssue } = buildService();
  addIssue({ issueId: "high-old", priority: "tinggi", observedAt: "2026-07-22T08:00:00.000Z", relevance: "low" });
  addIssue({ issueId: "high-new-b", priority: "tinggi", observedAt: "2026-07-22T11:00:00.000Z", relevance: "none" });
  addIssue({ issueId: "high-new-a", priority: "tinggi", observedAt: "2026-07-22T11:00:00.000Z", relevance: "high" });
  addIssue({ issueId: "medium", priority: "sedang", observedAt: "2026-07-22T11:30:00.000Z", relevance: "high" });
  addIssue({ issueId: "low", priority: "rendah", observedAt: "2026-07-22T11:45:00.000Z", relevance: "high" });
  addIssue({ issueId: "sixth", priority: "rendah", observedAt: "2026-07-22T11:50:00.000Z", relevance: "high" });
  for (let i = 7; i <= 22; i += 1) {
    addIssue({ issueId: `extra-${String(i).padStart(2, "0")}`, priority: "rendah", observedAt: `2026-07-22T11:${String(i).padStart(2, "0")}:00.000Z`, relevance: "high" });
  }

  const summary = await service.getExecutiveSummary({ tenantId, companyId, period: "24jam" });
  assert.equal(summary.items.length, 20);
  assert.deepEqual(summary.items.slice(0, 5).map((item) => item.issueId), ["high-new-a", "high-new-b", "high-old", "medium", "sixth"]);
  assert.deepEqual(summary.items.slice(0, 5).map((item) => item.priority), ["tinggi", "tinggi", "tinggi", "sedang", "rendah"]);
  assert.equal(summary.items[5].issueId, "low");
  assert.equal(summary.items[19].issueId, "extra-09");
  assert.equal(Object.hasOwn(summary.items[0], "relevance"), false);
  assert.equal(Object.hasOwn(summary.items[0], "rank"), false);
});

test("Executive Summary excludes inactive, stale, cross-company, and invalid-current-priority issues", async () => {
  const { service, issueStore, addIssue } = buildService();
  addIssue({ issueId: "eligible", priority: "tinggi", observedAt: "2026-07-22T11:00:00.000Z" });
  addIssue({ issueId: "stale", priority: "tinggi", observedAt: "2026-07-20T11:00:00.000Z" });
  addIssue({ issueId: "done", priority: "tinggi", observedAt: "2026-07-22T11:00:00.000Z", status: "selesai" });
  addIssue({ issueId: "other-company", priority: "tinggi", observedAt: "2026-07-22T11:00:00.000Z", company: "company-b" });
  addIssue({ issueId: "superseded-analysis", priority: "tinggi", observedAt: "2026-07-22T11:00:00.000Z", current: false });
  addIssue({ issueId: "mismatched-development", priority: "tinggi", observedAt: "2026-07-22T11:00:00.000Z" });
  issueStore.developmentsById.get("development-mismatched-development").observedAt = "2026-07-22T10:00:00.000Z";

  const summary = await service.getExecutiveSummary({ tenantId, companyId, period: "24jam" });
  assert.deepEqual(summary.items.map((item) => item.issueId), ["eligible"]);
});

test("Executive Summary excludes a raw issue that has no current analysis or priority", async () => {
  const { service, issueStore } = buildService();
  issueStore.seed({
    issueId: "raw-incomplete",
    tenantId,
    companyId,
    title: "Raw issue only",
    oneLiner: "Needs downstream validation.",
    status: "berkembang",
    currentPriority: null,
    currentPriorityAnalysisId: null,
    currentPriorityDecisionId: null,
    firstSeenAt: "2026-07-22T10:00:00.000Z",
    lastDevelopedAt: "2026-07-22T11:00:00.000Z",
    version: 1,
    closedAt: null,
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T11:00:00.000Z",
  });
  issueStore.developmentsById.set("development-raw-incomplete", {
    developmentId: "development-raw-incomplete",
    tenantId,
    companyId,
    issueId: "raw-incomplete",
    observedAt: "2026-07-22T11:00:00.000Z",
    developmentType: "updated",
  });

  const summary = await service.getExecutiveSummary({ tenantId, companyId, period: "24jam" });
  assert.deepEqual(summary.items, []);
});

test("Executive Summary validates its UI period and company authorization without any AI dependency", async () => {
  const { service } = buildService();
  await assert.rejects(service.getExecutiveSummary({ tenantId, companyId, period: "90hari" }), { code: "AI_CONFIGURATION_INVALID" });
  await assert.rejects(service.getExecutiveSummary({ tenantId, companyId: "company-b", period: "24jam" }), { code: "AI_CONFIGURATION_INVALID" });
  assert.equal(Object.hasOwn(service, "aiTaskKernel"), false);
});
