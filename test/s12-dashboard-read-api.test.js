const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createDashboardRouter } = require("../src/routes/dashboard");

const auth = { tenantId: "tenant-1", companyId: "company-1" };
function listen(services) { const app = express(); app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1" }, ...auth, scopeTrusted: true }; next(); }); app.use(createDashboardRouter({ getExecutiveSummaryService: () => services.summary, getIssueReadService: () => services.issues })); const server = http.createServer(app); return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server))); }

test("S12 Executive Summary is backend Top 5 while search exposes all issues", async () => {
  const server = await listen({ summary: { getExecutiveSummary: async () => ({ period: "24jam", items: Array.from({ length: 5 }, (_, i) => ({ issueId: `top-${i + 1}` })) }) }, issues: { list: async () => ({ items: Array.from({ length: 12 }, (_, i) => ({ issue_id: `issue-${i + 1}` })), page: 1, limit: 20, total: 12 }), detail: async ({ issueId }) => ({ issue_id: issueId, articles: [], developments: [] }) } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const summary = await fetch(`${base}/api/v1/dashboard/executive-summary?period=24jam`); const search = await fetch(`${base}/api/v1/issues?q=issue-12`); const detail = await fetch(`${base}/api/v1/issues/issue-12`);
    const summaryBody = await summary.json(); const searchBody = await search.json(); const detailBody = await detail.json();
    assert.equal(summary.status, 200); assert.equal(summaryBody.data.issues.length, 5); assert.equal(summaryBody.data.top5_limit, 5); assert.equal(search.status, 200); assert.equal(searchBody.data.meta.total, 12); assert.equal(detail.status, 200); assert.equal(detailBody.data.issue_id, "issue-12");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S12 dashboard cannot read another company", async () => {
  const server = await listen({ summary: { getExecutiveSummary: async () => { throw new Error("must not call"); } }, issues: {} });
  try { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/dashboard/executive-summary?company_id=company-2`); assert.equal(response.status, 403); assert.equal((await response.json()).error.code, "SCOPE_CONTEXT_UNTRUSTED"); } finally { await new Promise((resolve) => server.close(resolve)); }
});
