const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createPriorityRouter } = require("../src/routes/priority");

const scope = { tenantId: "tenant-1", companyId: "company-1" };
function listen(services) { const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1" }, ...scope, scopeTrusted: true }; next(); }); app.use(createPriorityRouter({ getT09Service: () => services.t09, getT10Service: () => services.t10 })); const server = http.createServer(app); return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server))); }
const headers = { "Content-Type": "application/json", "Idempotency-Key": "priority-api-key-1" };

test("S11 T09 and T10 return priority data without Top 5 computation", async () => {
  const calls = [];
  const server = await listen({
    t09: { evaluate: async (input) => { calls.push(["t09", input]); return { priority: { priorityDecisionId: "p1", priority: "tinggi" }, issue: { issueId: input.issueId, currentPriority: "tinggi" }, analysis: { analysisId: input.analysisId }, reused: false }; } },
    t10: { generate: async (input) => { calls.push(["t10", input]); return { reason: { priorityReasonId: "r1", reason: "Dampak tinggi." }, priorityDecision: { priorityDecisionId: input.priorityDecisionId, priority: "tinggi" }, analysis: { analysisId: input.analysisId }, reused: false }; } },
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const priority = await fetch(`${base}/api/v1/internal/issues/issue-1/priority`, { method: "POST", headers, body: JSON.stringify({ analysis_id: "analysis-1" }) });
    const reason = await fetch(`${base}/api/v1/internal/issues/issue-1/priority/reason`, { method: "POST", headers, body: JSON.stringify({ analysis_id: "analysis-1", priority_decision_id: "p1" }) });
    const priorityBody = await priority.json(); const reasonBody = await reason.json();
    assert.equal(priority.status, 200); assert.equal(reason.status, 200); assert.equal(priorityBody.data.priority.priority, "tinggi"); assert.equal(reasonBody.data.reason.reason, "Dampak tinggi."); assert.equal(priorityBody.data.top5, false); assert.equal(reasonBody.data.top5, false); assert.deepEqual(calls.map(([name]) => name), ["t09", "t10"]);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S11 priority endpoint requires idempotency and trusted scope", async () => {
  const server = await listen({ t09: { evaluate: async () => { throw new Error("must not call"); } }, t10: {} });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/issues/issue-1/priority`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
