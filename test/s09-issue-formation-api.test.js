const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createIssueFormationRouter } = require("../src/routes/issues");

const scope = { tenantId: "tenant-1", companyId: "company-1" };
function appWith(services) { const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1" }, ...scope, scopeTrusted: true }; next(); }); app.use(createIssueFormationRouter({ getT04Service: () => services.t04, getIssueMutationService: () => services.mutation, getT05Service: () => services.t05, getT06Service: () => services.t06 })); return app; }
function listen(app) { const server = http.createServer(app); return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server))); }

test("S09 T04 new/update and mutation endpoints preserve idempotent result", async () => {
  let matches = 0; let mutations = 0;
  const server = await listen(appWith({
    t04: { match: async (input) => ({ match: { matchDecisionId: `m-${++matches}`, decision: "new", candidateIssueId: null }, relevanceDecision: { decisionId: input.relevanceDecisionId }, reused: matches > 1 }) },
    mutation: { apply: async () => ({ mutation: { mutationId: `mutation-${++mutations}`, outcome: "applied", issueId: "issue-1" }, reused: mutations > 1 }) }, t05: {}, t06: {},
  }));
  const base = `http://127.0.0.1:${server.address().port}`; const headers = { "Content-Type": "application/json", "Idempotency-Key": "issue-formation-key-1" };
  try {
    const match = await fetch(`${base}/api/v1/internal/issues/match`, { method: "POST", headers, body: JSON.stringify({ tenant_id: scope.tenantId, company_id: scope.companyId, relevance_decision_id: "d1" }) });
    assert.equal(match.status, 200); assert.equal((await match.json()).data.match.decision, "new");
    const form = await fetch(`${base}/api/v1/internal/issues/form`, { method: "POST", headers, body: JSON.stringify({ tenant_id: scope.tenantId, company_id: scope.companyId, match_decision_id: "m-1" }) });
    assert.equal(form.status, 200); assert.equal((await form.json()).data.mutation.outcome, "applied");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S09 title and one-liner endpoints require idempotency and preserve service output", async () => {
  const calls = []; const server = await listen(appWith({ t04: {}, mutation: {}, t05: { generate: async (input) => { calls.push(["title", input]); return { title: { titleGenerationId: "tg-1", title: "Judul isu" }, issue: { issueId: input.issueId }, reused: false }; } }, t06: { generate: async (input) => { calls.push(["one-liner", input]); return { oneLiner: { oneLinerGenerationId: "og-1", oneLiner: "Ringkasan isu" }, issue: { issueId: input.issueId }, reused: false }; } } }));
  try {
    const noKey = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/issues/issue-1/title`, { method: "POST" }); assert.equal(noKey.status, 400);
    const headers = { "Idempotency-Key": "title-one-liner-key-1" };
    const title = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/issues/issue-1/title`, { method: "POST", headers });
    const oneLiner = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/issues/issue-1/one-liner`, { method: "POST", headers });
    assert.equal(title.status, 200); assert.equal(oneLiner.status, 200); assert.equal(calls.length, 2);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S09 endpoints reject a request scope that differs from the authenticated company", async () => {
  const server = await listen(appWith({ t04: {}, mutation: {}, t05: { generate: async () => { throw new Error("must not call"); } }, t06: {} }));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/issues/match`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "scope-check-key-1" }, body: JSON.stringify({ tenant_id: "tenant-1", company_id: "company-2", relevance_decision_id: "d1" }) });
    assert.equal(response.status, 403); assert.equal((await response.json()).error.code, "SCOPE_CONTEXT_UNTRUSTED");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
