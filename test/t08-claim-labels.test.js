const assert = require("node:assert/strict");
const test = require("node:test");
const { InMemoryIssueAnalysisStore } = require("../src/ai/tasks/t07-issue-analysis");
const { createT08ClaimLabelsRuntime } = require("../src/ai/tasks/t08-claim-labels");

const tenantId = "tenant-h";
const companyId = "company-a";

function makeAnalysis(store) {
  return store.create({
    tenantId, companyId, issueId: "issue-1", contextVersion: 3, inputFingerprint: "fingerprint-1", promptVersion: "1.0.0",
    analysis: {
      what_happened: "Perubahan regulasi diumumkan.", why_matters: "Operasi dapat terpengaruh.", impacts: [], risks: [], watch: [],
      claims: [
        { claim_id: "c1", text: "Regulasi menyasar operator logistik.", source_article_ids: ["123e4567-e89b-12d3-a456-426614174000"] },
        { claim_id: "c2", text: "Perusahaan mungkin perlu menyesuaikan proses.", source_article_ids: ["123e4567-e89b-12d3-a456-426614174001"] },
      ],
    }, evidence: [], provenance: { runId: "t07-run" },
  });
}

function buildRuntime({ output = { labels: [{ claim_id: "c1", label: "fact" }, { claim_id: "c2", label: "analysis" }] }, onKernelRequest } = {}) {
  const analysisStore = new InMemoryIssueAnalysisStore({ uuid: () => "analysis-1", now: () => 0 });
  const analysis = makeAnalysis(analysisStore);
  let kernelCalls = 0;
  const runtime = createT08ClaimLabelsRuntime({
    aiTaskKernel: { execute: async (request) => {
      kernelCalls += 1; onKernelRequest?.(request);
      return { data: output, model: { alias: "nano", name: "nano-test-model" }, correlation: { requestId: request.requestId, providerRequestId: "req_t08" }, providerResponseId: "resp_t08", usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 }, latencyMs: 14 };
    } },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" }, analysisStore,
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "analysis.claims.label",
  });
  return { runtime, analysisStore, analysis, kernelCalls: () => kernelCalls };
}

test("T08 labels every immutable T07 claim exactly once without changing analysis claims", async () => {
  let input;
  const { runtime, analysisStore, analysis, kernelCalls } = buildRuntime({ onKernelRequest: (request) => { input = request.input; } });
  const before = analysisStore.getById(analysis.analysisId);
  const result = await runtime.service.label({ tenantId, companyId, analysisId: analysis.analysisId });
  assert.equal(kernelCalls(), 1);
  assert.equal(result.reused, false);
  assert.deepEqual(result.labels.labels, [{ claim_id: "c1", label: "fact" }, { claim_id: "c2", label: "analysis" }]);
  assert.deepEqual(analysisStore.getById(analysis.analysisId), before);
  assert.match(input[1].content, /<UNTRUSTED_CLAIM_TEXT>/);
  assert.match(input[1].content, /Regulasi menyasar operator logistik/);
  assert.equal(Object.hasOwn(result.labels, "claims"), false);
});

test("T08 is idempotent for the same analysis and prompt version", async () => {
  const { runtime, analysis, kernelCalls } = buildRuntime();
  const first = await runtime.service.label({ tenantId, companyId, analysisId: analysis.analysisId });
  const second = await runtime.service.label({ tenantId, companyId, analysisId: analysis.analysisId });
  assert.equal(second.reused, true);
  assert.equal(second.labels.labelRunId, first.labels.labelRunId);
  assert.equal(kernelCalls(), 1);
});

test("T08 rejects added, removed, or rewritten claims without persisting labels", async (t) => {
  for (const [name, output] of [
    ["added", { labels: [{ claim_id: "c1", label: "fact" }, { claim_id: "c2", label: "analysis" }, { claim_id: "c3", label: "fact" }] }],
    ["removed", { labels: [{ claim_id: "c1", label: "fact" }] }],
    ["rewritten", { labels: [{ claim_id: "c1", label: "fact", text: "rewritten" }, { claim_id: "c2", label: "analysis" }] }],
  ]) {
    await t.test(name, async () => {
      const { runtime, analysis } = buildRuntime({ output });
      await assert.rejects(runtime.service.label({ tenantId, companyId, analysisId: analysis.analysisId }), { code: "AI_OUTPUT_SCHEMA_INVALID" });
      assert.deepEqual(runtime.labelStore.list(), []);
      assert.equal(runtime.runStore.list()[0].validationOutcome, "failed");
    });
  }
});

test("T08 does not call the model for a cross-scope analysis", async () => {
  const { runtime, analysis, kernelCalls } = buildRuntime();
  await assert.rejects(runtime.service.label({ tenantId: "tenant-other", companyId, analysisId: analysis.analysisId }), { code: "AI_CONFIGURATION_INVALID" });
  assert.equal(kernelCalls(), 0);
});
