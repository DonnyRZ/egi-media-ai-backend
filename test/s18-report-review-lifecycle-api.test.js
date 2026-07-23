const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createReportRouter } = require("../src/routes/reports");
const { InMemoryReportDraftStore, InMemoryReportNarrativeStore, ReportLifecycleService } = require("../src/reports");
const { T13_PROMPT_VERSION } = require("../src/ai/tasks/t13-report-narrative");

const scope = { tenantId: "tenant-1", companyId: "company-1" };
function runtime() {
  const draftStore = new InMemoryReportDraftStore({ uuid: () => "report-1", now: () => 0 });
  const narrativeStore = new InMemoryReportNarrativeStore({ uuid: () => "narrative-1", now: () => 0 });
  const report = draftStore.createDraft({ ...scope, reportType: "mingguan", periodStart: "2026-07-15T00:00:00.000Z", periodEnd: "2026-07-22T00:00:00.000Z", timezone: "Asia/Jakarta", contextVersion: 3, metrics: {}, selectedIssuePack: [] });
  narrativeStore.create({ ...scope, reportId: report.reportId, promptVersion: T13_PROMPT_VERSION, narrative: { executiveSummary: "Draft" }, provenance: {} });
  const shareIntents = [];
  const lifecycleService = new ReportLifecycleService({ reportDraftStore: draftStore, narrativeStore, authorizeReportAction: async ({ actor }) => actor?.actorType === "human", sharePublisher: { share: async ({ shareTarget }) => shareIntents.push(shareTarget) } });
  return { draftStore, lifecycleService, shareIntents };
}
function listen(runtimeValue, actorType = "human") {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1", actorType }, ...scope, scopeTrusted: true }; next(); });
  app.use(createReportRouter({ getReportRuntime: () => runtimeValue }));
  const server = http.createServer(app); return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
function headers(key) { return { "Content-Type": "application/json", "Idempotency-Key": `${key}-0000000001` }; }

test("S18 moves a report through review, approval, and share with human actor", async () => {
  const value = runtime(); const server = await listen(value); const base = `http://127.0.0.1:${server.address().port}/api/v1/reports/report-1`;
  try {
    const review = await fetch(`${base}/review`, { method: "POST", headers: headers("review"), body: JSON.stringify({ action: "submit", version: 1 }) });
    assert.equal(review.status, 200); assert.equal((await review.json()).data.review_status, "in_review");
    const approve = await fetch(`${base}/approve`, { method: "POST", headers: headers("approve"), body: JSON.stringify({ version: 2 }) });
    assert.equal(approve.status, 200); assert.equal((await approve.json()).data.review_status, "approved");
    const share = await fetch(`${base}/share`, { method: "POST", headers: headers("share"), body: JSON.stringify({ version: 3, recipient_refs: ["board-1"] }) });
    assert.equal(share.status, 202); assert.equal((await share.json()).data.review_status, "shared"); assert.deepEqual(value.shareIntents, [{ recipientRefs: ["board-1"] }]);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S18 rejects AI actors from approval and share", async () => {
  const value = runtime(); const server = await listen(value, "ai");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/reports/report-1/approve`, { method: "POST", headers: headers("ai-approve"), body: JSON.stringify({ version: 1 }) });
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "AI_CONFIGURATION_INVALID"); assert.equal(value.draftStore.get({ ...scope, reportId: "report-1" }).reviewStatus, "draft");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
