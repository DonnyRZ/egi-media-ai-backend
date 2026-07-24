const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createRelevanceRouter } = require("../src/routes/relevance");

const companyId = "company-1";
function appWith(services) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1" }, tenantId: "tenant-1", companyId, scopeTrusted: true }; next(); });
  app.use(createRelevanceRouter({ getT02Service: () => services.t02, getT03Service: () => services.t03 }));
  return app;
}

test("S08 T02 endpoint integrates the relevance service and preserves branch", async () => {
  const app = appWith({ t02: { classify: async (input) => ({ decision: { decisionId: "d1", articleId: input.articleId, companyId, contextVersion: 2, relevance: "none", confidence: 0.91, branch: "stop", source: { sourceArticleId: input.articleId }, createdAt: "2026-07-23T00:00:00.000Z" }, reused: false, shouldContinue: false }) }, t03: {} });
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/relevance/classify`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "relevance-key-0001" }, body: JSON.stringify({ company_id: companyId, article_id: "article-1", locale: "id" }) });
    const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.data.decision.relevance, "none"); assert.equal(body.data.should_continue, false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S08 T03 endpoint cannot cross the authenticated company scope", async () => {
  let called = false;
  const app = appWith({ t02: {}, t03: { generate: async () => { called = true; } } });
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/relevance/rationale`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "rationale-key-0001" }, body: JSON.stringify({ company_id: "company-2", decision_id: "d1" }) });
    assert.equal(response.status, 403); assert.equal((await response.json()).error.code, "SCOPE_CONTEXT_UNTRUSTED"); assert.equal(called, false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
