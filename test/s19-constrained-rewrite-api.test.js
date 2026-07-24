const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createReportRouter } = require("../src/routes/reports");

const scope = { tenantId: "tenant-1", companyId: "company-1" };
const headers = { "Content-Type": "application/json", "Idempotency-Key": "rewrite-api-000000001" };
function listen(service, actorType = "human") {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1", actorType }, ...scope, scopeTrusted: true }; next(); });
  app.use(createReportRouter({ getReportRuntime: () => ({ rewriteService: service }) }));
  const server = http.createServer(app); return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("S19 rewrites one human-selected span and returns its unchanged citation set", async () => {
  const calls = []; const server = await listen({ rewrite: async (input) => { calls.push(input); return { reused: false, narrative: { reportNarrativeId: "narrative-1", reportId: "report-1", promptVersion: "1.0.0", narrative: { issueNarratives: [{ reportItemId: "item-1", narrative: "Versi baru", sourceClaimIds: ["claim-1"] }] }, reviewStatus: "draft", version: 2, createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z" }, rewrittenSpan: { spanId: "issue_narrative:item-1", sourceClaimIds: ["claim-1"] } }; } });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/reports/report-1/narrative/narrative-1/rewrite`, { method: "POST", headers, body: JSON.stringify({ version: 1, allowed_span_id: "issue_narrative:item-1", instruction: "Buat lebih ringkas." }) });
    const body = await response.json(); assert.equal(response.status, 200); assert.deepEqual(body.data.rewritten_span.source_claim_ids, ["claim-1"]); assert.equal(calls[0].actor.actorType, "human"); assert.equal(calls[0].expectedVersion, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S19 requires version and rejects AI actor before rewrite", async () => {
  let called = false; const server = await listen({ rewrite: async () => { called = true; } }, "ai");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/reports/report-1/narrative/narrative-1/rewrite`, { method: "POST", headers, body: JSON.stringify({ version: 1, allowed_span_id: "issue_narrative:item-1", instruction: "Rewrite" }) });
    assert.equal(response.status, 403); assert.equal(called, false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
