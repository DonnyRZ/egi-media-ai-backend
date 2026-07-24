const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createAnalysisRouter } = require("../src/routes/analysis");

const auth = { tenantId: "tenant-1", companyId: "company-1" };
function listen(services) { const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1" }, ...auth, scopeTrusted: true }; next(); }); app.use(createAnalysisRouter({ getT07Service: () => services.t07, getT08Service: () => services.t08, getCitationGate: () => services.gate })); const server = http.createServer(app); return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server))); }
const headers = { "Content-Type": "application/json", "Idempotency-Key": "analysis-api-key-1" };

test("S10 exposes T07 analysis, T08 labels, and current-analysis promotion", async () => {
  const calls = [];
  const server = await listen({
    t07: { analyze: async (input) => { calls.push(["t07", input]); return { analysis: { analysisId: "analysis-1", status: "validated", analysis: { claims: [] } }, reused: false }; } },
    t08: { label: async (input) => { calls.push(["t08", input]); return { labels: { labelRunId: "labels-1", labels: [{ claim_id: "c1", label: "fact" }] }, reused: false }; } },
    gate: { validateAndPromote: async (input) => { calls.push(["gate", input]); return { analysisId: "analysis-1", status: "current", gate: { citationStatus: "passed" } }; } },
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const analyze = await fetch(`${base}/api/v1/internal/issues/issue-1/analyze`, { method: "POST", headers, body: "{}" });
    const labels = await fetch(`${base}/api/v1/internal/analyses/analysis-1/labels`, { method: "POST", headers, body: "{}" });
    const promote = await fetch(`${base}/api/v1/internal/analyses/analysis-1/promote-current`, { method: "POST", headers, body: "{}" });
    assert.equal(analyze.status, 200); assert.equal(labels.status, 200); assert.equal(promote.status, 200); assert.equal((await promote.json()).data.analysis.status, "current");
    assert.deepEqual(calls.map(([name]) => name), ["t07", "t08", "gate"]);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S10 current gate failure is returned and does not become current", async () => {
  const server = await listen({ t07: {}, t08: {}, gate: { validateAndPromote: async () => { throw Object.assign(new Error("citation failed"), { code: "AI_CONFIGURATION_INVALID", statusCode: 503 }); } } });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/analyses/analysis-1/promote-current`, { method: "POST", headers, body: "{}" });
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "AI_CONFIGURATION_INVALID");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
