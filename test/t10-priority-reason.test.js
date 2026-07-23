const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryIssueStore } = require("../src/issues");
const { InMemoryIssueAnalysisStore } = require("../src/ai/tasks/t07-issue-analysis");
const { InMemoryClaimLabelStore } = require("../src/ai/tasks/t08-claim-labels");
const { InMemoryIssuePriorityStore, T09_PROMPT_VERSION } = require("../src/ai/tasks/t09-priority-enum");
const { createT10PriorityReasonRuntime } = require("../src/ai/tasks/t10-priority-reason");

const tenantId = "tenant-h";
const companyId = "company-a";
const issueId = "issue-1";

function buildRuntime({ output = { reason: "Perubahan regulasi berpotensi memengaruhi kepatuhan dan operasi armada.", source_claim_ids: ["c1"] }, onKernelRequest, labels = true, currentPriority = true } = {}) {
  const issueStore = new InMemoryIssueStore({ uuid: () => "generated-id", now: () => Date.parse("2026-07-22T12:00:00.000Z") });
  issueStore.seed({
    issueId, tenantId, companyId, title: "Perubahan regulasi logistik", oneLiner: "Regulasi baru diumumkan.", status: "berkembang",
    currentPriority: "tinggi", currentPriorityAnalysisId: "analysis-1", currentPriorityDecisionId: "priority-1",
    firstSeenAt: "2026-07-21T12:00:00.000Z", lastDevelopedAt: "2026-07-22T11:00:00.000Z", version: 3,
    closedAt: null, createdAt: "2026-07-21T12:00:00.000Z", updatedAt: "2026-07-22T11:00:00.000Z",
  });
  const analysisStore = new InMemoryIssueAnalysisStore({ uuid: () => "analysis-1", now: () => 0 });
  const analysis = analysisStore.create({
    tenantId, companyId, issueId, contextVersion: 3, inputFingerprint: "analysis-fingerprint", promptVersion: "1.0.0",
    analysis: {
      what_happened: "Regulator mengumumkan ketentuan baru.", why_matters: "Kepatuhan armada dapat berubah.", impacts: [], risks: [], watch: [],
      claims: [
        { claim_id: "c1", text: "Ketentuan menyasar operator logistik.", source_article_ids: ["article-1"] },
        { claim_id: "c2", text: "Operator mungkin perlu menyesuaikan proses.", source_article_ids: ["article-2"] },
      ],
    }, evidence: [], provenance: { runId: "t07-run" },
  });
  analysisStore.promoteCurrent({ tenantId, companyId, analysisId: analysis.analysisId, gate: { gateStatus: "passed" } });
  const priorityStore = new InMemoryIssuePriorityStore({ uuid: () => "priority-1", now: () => 0 });
  const priority = priorityStore.create({ tenantId, companyId, issueId, analysisId: analysis.analysisId, contextVersion: 3, promptVersion: T09_PROMPT_VERSION, priority: "tinggi", provenance: { runId: "t09-run" } });
  if (!currentPriority) {
    issueStore.issuesById.get(issueId).currentPriorityDecisionId = "other-priority";
  }
  const labelStore = new InMemoryClaimLabelStore({ uuid: () => "labels-1", now: () => 0 });
  if (labels) labelStore.create({
    tenantId, companyId, issueId, analysisId: analysis.analysisId, promptVersion: "1.0.0",
    labels: [{ claim_id: "c1", label: "fact" }, { claim_id: "c2", label: "analysis" }], provenance: { runId: "t08-run" },
  });
  let kernelCalls = 0;
  const runtime = createT10PriorityReasonRuntime({
    aiTaskKernel: { execute: async (request) => {
      kernelCalls += 1;
      onKernelRequest?.(request);
      return {
        data: output, model: { alias: "mini", name: "mini-test-model" },
        correlation: { requestId: request.requestId, providerRequestId: "req_t10" }, providerResponseId: "resp_t10",
        usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 }, latencyMs: 15,
      };
    } },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    issueStore, analysisStore, priorityStore, labelStore,
    getEffectiveContext: async () => ({ companyId, version: 3, status: "effective", fields: { name: "PT Example", industry: "Logistics" } }),
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "issue.priority.reason.generate",
  });
  return { runtime, issueStore, analysisStore, analysis, priority, kernelCalls: () => kernelCalls };
}

test("T10 uses Mini to store a grounded reason without changing T09 priority", async () => {
  let request;
  const { runtime, issueStore, analysis, priority, kernelCalls } = buildRuntime({ onKernelRequest: (value) => { request = value; } });
  const beforeIssue = issueStore.getIssue({ tenantId, companyId, issueId });
  const result = await runtime.service.generate({ tenantId, companyId, issueId, analysisId: analysis.analysisId, priorityDecisionId: priority.priorityDecisionId });

  assert.equal(kernelCalls(), 1);
  assert.equal(result.reused, false);
  assert.equal(result.reason.reason, "Perubahan regulasi berpotensi memengaruhi kepatuhan dan operasi armada.");
  assert.deepEqual(result.reason.sourceClaimIds, ["c1"]);
  assert.deepEqual(issueStore.getIssue({ tenantId, companyId, issueId }), beforeIssue);
  assert.equal(request.model, "mini");
  assert.match(request.input[1].content, /"immutable":\["priority_decision.priority"\]/);
  assert.match(request.input[1].content, /"priority":"tinggi"/);
  assert.match(request.input[1].content, /<UNTRUSTED_VALIDATED_ANALYSIS>/);
  assert.doesNotMatch(request.input[1].content, /RAW_ARTICLE_BODY/);
});

test("T10 is idempotent for the same immutable T09 decision and prompt version", async () => {
  const { runtime, analysis, priority, kernelCalls } = buildRuntime();
  const first = await runtime.service.generate({ tenantId, companyId, issueId, analysisId: analysis.analysisId, priorityDecisionId: priority.priorityDecisionId });
  const second = await runtime.service.generate({ tenantId, companyId, issueId, analysisId: analysis.analysisId, priorityDecisionId: priority.priorityDecisionId });
  assert.equal(second.reused, true);
  assert.equal(second.reason.priorityReasonId, first.reason.priorityReasonId);
  assert.equal(kernelCalls(), 1);
});

test("T10 rejects priority changes and unsupported claim IDs without storing a reason", async (t) => {
  for (const [name, output] of [
    ["priority change", { priority: "rendah", reason: "Tidak dapat dipakai.", source_claim_ids: ["c1"] }],
    ["invented claim", { reason: "Tidak dapat dipakai.", source_claim_ids: ["c9"] }],
  ]) {
    await t.test(name, async () => {
      const { runtime, analysis, priority, issueStore } = buildRuntime({ output });
      const beforeIssue = issueStore.getIssue({ tenantId, companyId, issueId });
      await assert.rejects(runtime.service.generate({ tenantId, companyId, issueId, analysisId: analysis.analysisId, priorityDecisionId: priority.priorityDecisionId }), { code: "AI_OUTPUT_SCHEMA_INVALID" });
      assert.deepEqual(runtime.reasonStore.list(), []);
      assert.deepEqual(issueStore.getIssue({ tenantId, companyId, issueId }), beforeIssue);
      assert.equal(runtime.runStore.list()[0].validationOutcome, "failed");
    });
  }
});

test("T10 refuses missing T08 labels or a non-current T09 handoff before calling Mini", async (t) => {
  await t.test("missing labels", async () => {
    const { runtime, analysis, priority, kernelCalls } = buildRuntime({ labels: false });
    await assert.rejects(runtime.service.generate({ tenantId, companyId, issueId, analysisId: analysis.analysisId, priorityDecisionId: priority.priorityDecisionId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });
  await t.test("priority decision is not current", async () => {
    const { runtime, analysis, priority, kernelCalls } = buildRuntime({ currentPriority: false });
    await assert.rejects(runtime.service.generate({ tenantId, companyId, issueId, analysisId: analysis.analysisId, priorityDecisionId: priority.priorityDecisionId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });
});
