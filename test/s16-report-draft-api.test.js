const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createReportRouter } = require("../src/routes/reports");

const scope = { tenantId: "tenant-1", companyId: "company-1" };
const headers = { "Content-Type": "application/json", "Idempotency-Key": "report-draft-api-001" };
const item = { report_item_id: "item-1", issue_id: "issue-1", analysis_id: "analysis-1", priority: "tinggi", title: "Regulasi baru", one_liner: "Perubahan regulasi berdampak pada operasi.", analysis: { what_happened: "Regulator menerbitkan aturan baru.", why_matters: "Operasi perlu menyesuaikan kepatuhan." }, claims: [{ claim_id: "claim-1", text: "Aturan baru diterbitkan.", source_article_ids: ["article-1"] }], citations: [{ source_article_id: "article-1", canonical_url: "https://portal.example/id/articles/article-1" }] };
const draftBody = { report_type: "mingguan", period_start: "2026-07-15T00:00:00.000Z", period_end: "2026-07-22T00:00:00.000Z", timezone: "Asia/Jakarta", context_version: 3, metrics: { period_start: "2026-07-15T00:00:00.000Z", period_end: "2026-07-22T00:00:00.000Z", issue_count: 1 }, selected_issue_pack: [item] };

function listen(runtime) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1" }, ...scope, scopeTrusted: true }; next(); });
  app.use(createReportRouter({ getReportRuntime: () => runtime }));
  const server = http.createServer(app); return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("S16 creates a period-specific report draft from validated issue insight only", async () => {
  const created = []; const runtime = { draftStore: { create: (draft) => { created.push(draft); return { ...draft, reportId: "report-1", version: 1, reviewStatus: "draft", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z" }; } }, narrativeService: {} };
  const server = await listen(runtime);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/reports/drafts`, { method: "POST", headers, body: JSON.stringify(draftBody) });
    const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.data.report_type, "mingguan"); assert.equal(created[0].selectedIssuePack[0].issueId, "issue-1"); assert.equal(Object.hasOwn(created[0].selectedIssuePack[0], "rawArticleBody"), false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S16 rejects raw article input and can generate a narrative only through the backend service", async () => {
  let generated = false; const runtime = { draftStore: { create: () => { throw new Error("not called"); } }, narrativeService: { generate: async (input) => { generated = true; return { reused: false, report: { reportId: input.reportId }, narrative: { reportNarrativeId: "narrative-1", reportId: input.reportId, promptVersion: "1.0.0", narrative: {}, reviewStatus: "draft", version: 1, createdAt: "now", updatedAt: "now" } }; } } };
  const server = await listen(runtime);
  try {
    const invalid = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/reports/drafts`, { method: "POST", headers, body: JSON.stringify({ ...draftBody, selected_issue_pack: [{ ...item, raw_article_body: "RAW" }] }) });
    assert.equal(invalid.status, 400);
    const narrative = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/reports/report-1/narrative`, { method: "POST", headers, body: "{}" });
    assert.equal(narrative.status, 200); assert.equal((await narrative.json()).data.narrative.report_narrative_id, "narrative-1"); assert.equal(generated, true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
