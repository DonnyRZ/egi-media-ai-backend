const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryIssueStore } = require("../src/issues");
const { InMemoryIssueAnalysisStore } = require("../src/ai/tasks/t07-issue-analysis");
const { createT09PriorityEnumRuntime } = require("../src/ai/tasks/t09-priority-enum");

const tenantId = "tenant-h";
const companyId = "company-a";
const issueId = "issue-1";

function buildRuntime({ output = { priority: "tinggi" }, onKernelRequest, current = true } = {}) {
  const issueStore = new InMemoryIssueStore({ uuid: () => "generated-id", now: () => Date.parse("2026-07-22T12:00:00.000Z") });
  issueStore.seed({
    issueId, tenantId, companyId, title: "Perubahan regulasi logistik", oneLiner: "Regulasi baru diumumkan.",
    status: "berkembang", currentPriority: null, firstSeenAt: "2026-07-21T12:00:00.000Z", lastDevelopedAt: "2026-07-22T11:00:00.000Z",
    version: 2, closedAt: null, createdAt: "2026-07-21T12:00:00.000Z", updatedAt: "2026-07-22T11:00:00.000Z",
  });
  issueStore.developmentsById.set("development-1", {
    developmentId: "development-1", tenantId, companyId, issueId, observedAt: "2026-07-22T11:00:00.000Z", developmentType: "updated",
  });
  const analysisStore = new InMemoryIssueAnalysisStore({ uuid: () => "analysis-1", now: () => 0 });
  const analysis = analysisStore.create({
    tenantId, companyId, issueId, contextVersion: 3, inputFingerprint: "analysis-fingerprint", promptVersion: "1.0.0",
    analysis: {
      what_happened: "Regulator mengumumkan ketentuan baru.", why_matters: "Kepatuhan armada dapat berubah.",
      impacts: [], risks: [], watch: [], claims: [{ claim_id: "c1", text: "Ketentuan menyasar operator logistik.", source_article_ids: ["article-1"] }],
    }, evidence: [], provenance: { runId: "t07-run" },
  });
  if (current) analysisStore.promoteCurrent({ tenantId, companyId, analysisId: analysis.analysisId, gate: { gateStatus: "passed" } });
  let kernelCalls = 0;
  const runtime = createT09PriorityEnumRuntime({
    aiTaskKernel: { execute: async (request) => {
      kernelCalls += 1;
      onKernelRequest?.(request);
      return {
        data: output, model: { alias: "nano", name: "nano-test-model" },
        correlation: { requestId: request.requestId, providerRequestId: "req_t09" }, providerResponseId: "resp_t09",
        usage: { inputTokens: 30, outputTokens: 5, totalTokens: 35 }, latencyMs: 10,
      };
    } },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    issueStore, analysisStore,
    getEffectiveContext: async () => ({ companyId, version: 3, status: "effective", fields: { name: "PT Example", industry: "Logistics" } }),
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "issue.priority.evaluate",
  });
  return { runtime, issueStore, analysisStore, analysis, kernelCalls: () => kernelCalls };
}

test("T09 uses Nano to persist exactly one priority enum for a current citation-gated analysis", async () => {
  let request;
  const { runtime, issueStore, analysis, kernelCalls } = buildRuntime({ onKernelRequest: (value) => { request = value; } });
  const result = await runtime.service.evaluate({ tenantId, companyId, issueId, analysisId: analysis.analysisId });

  assert.equal(kernelCalls(), 1);
  assert.equal(result.reused, false);
  assert.equal(result.priority.priority, "tinggi");
  assert.equal(result.priority.analysisId, analysis.analysisId);
  assert.equal(issueStore.getIssue({ tenantId, companyId, issueId }).currentPriority, "tinggi");
  assert.equal(request.model, "nano");
  assert.match(request.input[1].content, /<UNTRUSTED_VALIDATED_ANALYSIS>/);
  assert.match(request.input[1].content, /Ketentuan menyasar operator logistik/);
  assert.match(request.input[1].content, /"forbidden":\["priority reason","ranking","Top 5"/);
  assert.doesNotMatch(request.input[1].content, /RAW_ARTICLE_BODY/);
});

test("T09 is idempotent per analysis and prompt version", async () => {
  const { runtime, analysis, kernelCalls } = buildRuntime({ output: { priority: "sedang" } });
  const first = await runtime.service.evaluate({ tenantId, companyId, issueId, analysisId: analysis.analysisId });
  const second = await runtime.service.evaluate({ tenantId, companyId, issueId, analysisId: analysis.analysisId });
  assert.equal(second.reused, true);
  assert.equal(second.priority.priorityDecisionId, first.priority.priorityDecisionId);
  assert.equal(kernelCalls(), 1);
});

test("T09 rejects any output beyond its priority enum and does not update the issue", async () => {
  const { runtime, issueStore, analysis } = buildRuntime({ output: { priority: "tinggi", top_5_rank: 1 } });
  await assert.rejects(runtime.service.evaluate({ tenantId, companyId, issueId, analysisId: analysis.analysisId }), { code: "AI_OUTPUT_SCHEMA_INVALID" });
  assert.equal(issueStore.getIssue({ tenantId, companyId, issueId }).currentPriority, null);
  assert.deepEqual(runtime.priorityStore.list(), []);
  assert.equal(runtime.runStore.list()[0].validationOutcome, "failed");
});

test("T09 refuses non-current or cross-scope analysis before calling Nano", async (t) => {
  await t.test("validated but not citation-gated current", async () => {
    const { runtime, analysis, kernelCalls } = buildRuntime({ current: false });
    await assert.rejects(runtime.service.evaluate({ tenantId, companyId, issueId, analysisId: analysis.analysisId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });
  await t.test("cross-company request", async () => {
    const { runtime, analysis, kernelCalls } = buildRuntime();
    await assert.rejects(runtime.service.evaluate({ tenantId, companyId: "company-b", issueId, analysisId: analysis.analysisId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });
});
