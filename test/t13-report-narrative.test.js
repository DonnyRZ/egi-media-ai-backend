const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryReportDraftStore } = require("../src/reports");
const { createT13ReportNarrativeRuntime } = require("../src/ai/tasks/t13-report-narrative");

const tenantId = "tenant-h";
const companyId = "company-a";

function selectedItem(index) {
  return {
    reportItemId: `item-${index}`, issueId: `issue-${index}`, analysisId: `analysis-${index}`, priority: index <= 2 ? "tinggi" : "sedang",
    title: `Issue ${index}`, oneLiner: `One-liner ${index}`, rawArticleBody: "RAW_ARTICLE_BODY_MUST_NOT_REACH_T13",
    analysis: { whatHappened: `What happened ${index}`, whyMatters: `Why matters ${index}` },
    claims: [{ claimId: `c${index}`, text: `Validated claim ${index}`, sourceArticleIds: [`article-${index}`] }],
    citations: [{ sourceArticleId: `article-${index}`, canonicalUrl: `https://portal.example/id/articles/article-${index}` }],
  };
}

function outputFor(items) {
  const sourceReferences = items.map((item, index) => ({ claim_id: `c${index + 1}`, source_article_id: `article-${index + 1}` }));
  return {
    executive_summary: "Ringkasan eksekutif berdasarkan isu dan metrik yang dipilih backend.",
    issue_narratives: items.map((item, index) => ({ report_item_id: item.reportItemId, narrative: `Narasi issue ${index + 1}.`, source_claim_ids: [`c${index + 1}`] })),
    impact_narrative: { narrative: "Dampak gabungan perlu dipantau.", source_claim_ids: ["c1"] },
    watch_items: [{ narrative: "Pantau perkembangan regulator.", source_claim_ids: ["c2"] }],
    source_references: sourceReferences,
  };
}

function buildRuntime({ output, items = Array.from({ length: 6 }, (_, index) => selectedItem(index + 1)), onKernelRequest } = {}) {
  const reportDraftStore = new InMemoryReportDraftStore({ uuid: () => "report-1", now: () => 0 });
  const report = reportDraftStore.createDraft({
    tenantId, companyId, reportType: "mingguan", periodStart: "2026-07-15T00:00:00.000Z", periodEnd: "2026-07-22T00:00:00.000Z", timezone: "Asia/Jakarta", contextVersion: 3,
    metrics: { periodStart: "2026-07-15T00:00:00.000Z", periodEnd: "2026-07-22T00:00:00.000Z", values: { issue_count: items.length, high_priority_count: 2 } },
    selectedIssuePack: items,
  });
  let kernelCalls = 0;
  const runtime = createT13ReportNarrativeRuntime({
    aiTaskKernel: { execute: async (request) => {
      kernelCalls += 1; onKernelRequest?.(request);
      return { data: output || outputFor(items), model: { alias: "mini", name: "mini-test-model" }, correlation: { requestId: request.requestId, providerRequestId: "req_t13" }, providerResponseId: "resp_t13", usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 }, latencyMs: 20 };
    } },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" }, reportDraftStore,
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "report.narrative.generate",
  });
  return { runtime, reportDraftStore, report, items, kernelCalls: () => kernelCalls };
}

test("T13 uses Mini from a backend-selected six-issue pack and never raw articles or Top 5", async () => {
  let input;
  const { runtime, report, items, kernelCalls } = buildRuntime({ onKernelRequest: (request) => { input = request.input; } });
  const result = await runtime.service.generate({ tenantId, companyId, reportId: report.reportId });
  assert.equal(kernelCalls(), 1);
  assert.equal(result.reused, false);
  assert.equal(result.narrative.reviewStatus, "draft");
  assert.equal(result.narrative.narrative.issueNarratives.length, 6);
  assert.equal(input[0].content.includes("Top 5"), true);
  assert.match(input[1].content, /item-6/);
  assert.doesNotMatch(input[1].content, /RAW_ARTICLE_BODY_MUST_NOT_REACH_T13/);
  assert.doesNotMatch(input[1].content, /article content/i);
  assert.equal(input[1].content.includes("selected_issue_ids"), true);
  assert.equal(input[1].content.includes("backend_metrics"), true);
  assert.equal(input[1].content.includes("content"), false);
});

test("T13 is idempotent for the same backend report draft and prompt version", async () => {
  const { runtime, report, kernelCalls } = buildRuntime();
  const first = await runtime.service.generate({ tenantId, companyId, reportId: report.reportId });
  const second = await runtime.service.generate({ tenantId, companyId, reportId: report.reportId });
  assert.equal(second.reused, true);
  assert.equal(second.narrative.reportNarrativeId, first.narrative.reportNarrativeId);
  assert.equal(kernelCalls(), 1);
});

test("T13 rejects unselected report items or unsupported citations and marks the draft needs_review", async (t) => {
  await t.test("unselected report item", async () => {
    const items = [selectedItem(1), selectedItem(2)];
    const output = outputFor(items); output.issue_narratives[1].report_item_id = "item-99";
    const { runtime, report, reportDraftStore } = buildRuntime({ items, output });
    await assert.rejects(runtime.service.generate({ tenantId, companyId, reportId: report.reportId }), { code: "AI_OUTPUT_SCHEMA_INVALID" });
    assert.deepEqual(runtime.narrativeStore.list(), []);
    assert.equal(reportDraftStore.get({ tenantId, companyId, reportId: report.reportId }).reviewStatus, "needs_review");
  });
  await t.test("unsupported article citation", async () => {
    const items = [selectedItem(1), selectedItem(2)];
    const output = outputFor(items); output.source_references[0].source_article_id = "article-unknown";
    const { runtime, report, reportDraftStore } = buildRuntime({ items, output });
    await assert.rejects(runtime.service.generate({ tenantId, companyId, reportId: report.reportId }), { code: "AI_OUTPUT_SCHEMA_INVALID" });
    assert.deepEqual(runtime.narrativeStore.list(), []);
    assert.equal(reportDraftStore.get({ tenantId, companyId, reportId: report.reportId }).narrativeFailureCode, "invalid_narrative_output");
  });
});

test("T13 refuses a cross-company report before invoking Mini", async () => {
  const { runtime, report, kernelCalls } = buildRuntime();
  await assert.rejects(runtime.service.generate({ tenantId, companyId: "company-b", reportId: report.reportId }), { code: "AI_CONFIGURATION_INVALID" });
  assert.equal(kernelCalls(), 0);
});

test("T13 refuses period-inconsistent backend metrics before invoking Mini", async () => {
  const { runtime, report, reportDraftStore, kernelCalls } = buildRuntime();
  reportDraftStore.draftsById.get(report.reportId).metrics.periodEnd = "2026-07-23T00:00:00.000Z";
  await assert.rejects(runtime.service.generate({ tenantId, companyId, reportId: report.reportId }), { code: "AI_CONFIGURATION_INVALID" });
  assert.equal(kernelCalls(), 0);
  assert.equal(reportDraftStore.get({ tenantId, companyId, reportId: report.reportId }).reviewStatus, "needs_review");
});
