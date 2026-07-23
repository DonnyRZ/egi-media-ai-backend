const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../../src/config/global_config");
const { createAiTaskKernel, t13ReportNarrative } = require("../../src/ai");
const { InMemoryReportDraftStore } = require("../../src/reports");

test("S17 real Mini API returns a citation-valid report narrative", { timeout: 120000, skip: !process.env.RUN_OPENAI_INTEGRATION_TESTS || !process.env.OPENAI_API_KEY || !process.env.OPENAI_MINI_MODEL }, async () => {
  const tenantId = "tenant-s17-test"; const companyId = "company-s17-test";
  const reportDraftStore = new InMemoryReportDraftStore({ uuid: () => "report-s17", now: () => Date.parse("2026-07-23T00:00:00.000Z") });
  const report = reportDraftStore.createDraft({
    tenantId, companyId, reportType: "mingguan", periodStart: "2026-07-15T00:00:00.000Z", periodEnd: "2026-07-22T00:00:00.000Z", timezone: "Asia/Jakarta", contextVersion: 3,
    metrics: { periodStart: "2026-07-15T00:00:00.000Z", periodEnd: "2026-07-22T00:00:00.000Z", issueCount: 1 },
    selectedIssuePack: [{ reportItemId: "item-s17", issueId: "issue-s17", analysisId: "analysis-s17", priority: "tinggi", title: "Regulasi logistik baru", oneLiner: "Regulasi baru berpotensi memengaruhi operasi logistik.", analysis: { whatHappened: "Regulator menerbitkan aturan baru untuk operator logistik.", whyMatters: "Perusahaan perlu menilai dampak kepatuhan dan jadwal implementasi." }, claims: [{ claimId: "claim-s17", text: "Regulator menerbitkan aturan baru.", sourceArticleIds: ["article-s17"] }], citations: [{ sourceArticleId: "article-s17", canonicalUrl: "https://portal.example/id/articles/article-s17" }] }],
  });
  const runtime = t13ReportNarrative.createT13ReportNarrativeRuntime({ aiTaskKernel: createAiTaskKernel(), openaiConfig: config.get("/openai"), reportDraftStore, authorizeCompany: async ({ tenantId: actualTenant, companyId: actualCompany, action }) => actualTenant === tenantId && actualCompany === companyId && action === "report.narrative.generate" });
  const result = await runtime.service.generate({ tenantId, companyId, reportId: report.reportId });
  assert.equal(result.narrative.reviewStatus, "draft");
  assert.equal(result.narrative.narrative.issueNarratives[0].reportItemId, "item-s17");
  assert.ok(result.narrative.narrative.issueNarratives[0].sourceClaimIds.includes("claim-s17"));
  assert.ok(result.narrative.narrative.sourceReferences.some((reference) => reference.claimId === "claim-s17" && reference.sourceArticleId === "article-s17"));
});
