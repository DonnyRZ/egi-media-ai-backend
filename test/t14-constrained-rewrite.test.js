const assert = require("node:assert/strict");
const test = require("node:test");
const { InMemoryReportDraftStore, InMemoryReportNarrativeStore } = require("../src/reports");
const { createT14ConstrainedRewriteRuntime } = require("../src/ai/tasks/t14-constrained-rewrite");
const { T13_PROMPT_VERSION } = require("../src/ai/tasks/t13-report-narrative");

const tenantId = "tenant-h";
const companyId = "company-a";
const actor = Object.freeze({ actorType: "human", actorId: "analyst-1" });

function setup({ output = { replacement_text: "Narasi issue yang diperjelas tanpa menambah fakta." }, authorize = () => true, onKernelRequest } = {}) {
  const reportDraftStore = new InMemoryReportDraftStore({ uuid: sequence("report-1"), now: () => 0 });
  const narrativeStore = new InMemoryReportNarrativeStore({ uuid: sequence("narrative-1", "rewrite-1"), now: () => 0 });
  const report = reportDraftStore.createDraft({
    tenantId, companyId, reportType: "mingguan", periodStart: "2026-07-15T00:00:00.000Z", periodEnd: "2026-07-22T00:00:00.000Z", timezone: "Asia/Jakarta", contextVersion: 3, metrics: {},
    selectedIssuePack: [{ reportItemId: "item-1", issueId: "issue-1", analysisId: "analysis-1", priority: "tinggi", title: "Issue 1", oneLiner: "One liner", analysis: { whatHappened: "Peristiwa terjadi", whyMatters: "Penting" }, claims: [{ claimId: "c1", text: "Klaim tervalidasi", sourceArticleIds: ["article-1"] }], citations: [{ sourceArticleId: "article-1", canonicalUrl: "https://portal.example/id/articles/article-1" }] }],
  });
  const stored = narrativeStore.create({ tenantId, companyId, reportId: report.reportId, promptVersion: T13_PROMPT_VERSION, provenance: { runId: "t13-run" }, narrative: {
    executiveSummary: "Ringkasan tidak boleh berubah.",
    issueNarratives: [{ reportItemId: "item-1", narrative: "Narasi awal issue.", sourceClaimIds: ["c1"] }],
    impactNarrative: { narrative: "Dampak awal.", sourceClaimIds: ["c1"] },
    watchItems: [{ narrative: "Pantau regulasi.", sourceClaimIds: ["c1"] }],
    sourceReferences: [{ claimId: "c1", sourceArticleId: "article-1" }],
  } });
  let calls = 0;
  const runtime = createT14ConstrainedRewriteRuntime({
    aiTaskKernel: { execute: async (request) => { calls += 1; onKernelRequest?.(request); return { data: output, model: { alias: "nano", name: "nano-test-model" }, correlation: { requestId: request.requestId, providerRequestId: "req-t14" }, providerResponseId: "resp-t14", usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 }, latencyMs: 10 }; } },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" }, reportDraftStore, narrativeStore,
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.actor?.actorId === actor.actorId && scope.action === "report.narrative.rewrite" && authorize(scope),
  });
  return { runtime, reportDraftStore, narrativeStore, report, stored, calls: () => calls };
}

function request({ report, stored, ...overrides }) { return { tenantId, companyId, reportId: report.reportId, reportNarrativeId: stored.reportNarrativeId, expectedVersion: 1, allowedSpanId: "issue_narrative:item-1", humanInstruction: "Buat kalimat lebih ringkas dan jelas.", actor, ...overrides }; }
function sequence(...values) { let index = 0; return () => values[index++] || `id-${index}`; }

test("T14 uses Nano to replace exactly one human-authorized cited span and preserves its citation set", async () => {
  let input;
  const { runtime, report, stored, calls } = setup({ onKernelRequest: (value) => { input = value.input; } });
  const result = await runtime.service.rewrite(request({ report, stored }));
  assert.equal(calls(), 1);
  assert.equal(result.narrative.version, 2);
  assert.equal(result.narrative.narrative.issueNarratives[0].narrative, "Narasi issue yang diperjelas tanpa menambah fakta.");
  assert.deepEqual(result.narrative.narrative.issueNarratives[0].sourceClaimIds, ["c1"]);
  assert.equal(result.narrative.narrative.executiveSummary, "Ringkasan tidak boleh berubah.");
  assert.equal(result.narrative.narrative.impactNarrative.narrative, "Dampak awal.");
  assert.equal(result.narrative.narrative.watchItems[0].narrative, "Pantau regulasi.");
  assert.equal(result.narrative.rewrites.length, 1);
  assert.equal(result.narrative.rewrites[0].humanInstruction, undefined);
  assert.match(result.narrative.rewrites[0].instructionHash, /^[a-f0-9]{64}$/);
  assert.match(input[1].content, /issue_narrative:item-1/);
  assert.match(input[1].content, /Klaim tervalidasi/);
  assert.doesNotMatch(input[1].content, /Ringkasan tidak boleh berubah/);
});

test("T14 rejects output that adds citation fields or URLs without changing the target", async (t) => {
  await t.test("citation field", async () => {
    const { runtime, report, stored, narrativeStore } = setup({ output: { replacement_text: "Text", source_claim_ids: ["c1"] } });
    await assert.rejects(runtime.service.rewrite(request({ report, stored })), { code: "AI_OUTPUT_SCHEMA_INVALID" });
    assert.equal(narrativeStore.getById({ tenantId, companyId, reportNarrativeId: stored.reportNarrativeId }).version, 1);
  });
  await t.test("URL", async () => {
    const { runtime, report, stored, narrativeStore } = setup({ output: { replacement_text: "Lihat https://invented.example." } });
    await assert.rejects(runtime.service.rewrite(request({ report, stored })), { code: "AI_OUTPUT_SCHEMA_INVALID" });
    assert.equal(narrativeStore.getById({ tenantId, companyId, reportNarrativeId: stored.reportNarrativeId }).rewrites.length, 0);
  });
});

test("T14 refuses AI actors, stale target versions, uncited spans, and cross-company scope before Nano", async (t) => {
  await t.test("AI actor", async () => {
    const { runtime, report, stored, calls } = setup();
    await assert.rejects(runtime.service.rewrite(request({ report, stored, actor: { actorType: "ai", actorId: "t13" } })), /authenticated human/);
    assert.equal(calls(), 0);
  });
  await t.test("stale version", async () => {
    const { runtime, report, stored, calls } = setup();
    await assert.rejects(runtime.service.rewrite(request({ report, stored, expectedVersion: 2 })), /version conflict/);
    assert.equal(calls(), 0);
  });
  await t.test("uncited executive summary", async () => {
    const { runtime, report, stored, calls } = setup();
    await assert.rejects(runtime.service.rewrite(request({ report, stored, allowedSpanId: "executive_summary" })), /explicit cited report span/);
    assert.equal(calls(), 0);
  });
  await t.test("cross-company", async () => {
    const { runtime, report, stored, calls } = setup();
    await assert.rejects(runtime.service.rewrite(request({ report, stored, companyId: "company-b" })), /authorization/);
    assert.equal(calls(), 0);
  });
});

test("T14 does not rewrite a report once it has moved beyond draft", async () => {
  const { runtime, report, stored, reportDraftStore, calls } = setup();
  reportDraftStore.draftsById.get(report.reportId).reviewStatus = "in_review";
  await assert.rejects(runtime.service.rewrite(request({ report, stored })), /draft report/);
  assert.equal(calls(), 0);
});
