const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createAlertRouter } = require("../src/routes/alerts");

function listen(service) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1" }, tenantId: "tenant-1", companyId: "company-1", scopeTrusted: true }; next(); });
  app.use(createAlertRouter({ getT12Service: () => service, getAlertRuntime: () => ({}) }));
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const headers = { "Content-Type": "application/json", "Idempotency-Key": "direct-alert-api-001" };

test("S14 generates a T12 blurb without recipient, subject, or email send", async () => {
  const calls = [];
  const server = await listen({ generate: async (input) => { calls.push(input); return { reused: false, blurb: { directBlurbId: "blurb-1", alertEventId: "event-1", issueId: "issue-1", developmentId: "development-1", newDevelopmentBlurb: "Perkembangan baru.", shortImpactBlurb: "Dampak singkat.", sourceClaimIds: ["claim-1"], promptVersion: "1.0.0", createdAt: "2026-07-23T00:00:00.000Z" } }; } });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/alerts/event-1/direct-blurb`, { method: "POST", headers, body: "{}" });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.email_send, false);
    assert.equal(body.data.blurb.new_development_blurb, "Perkembangan baru.");
    assert.deepEqual(calls, [{ tenantId: "tenant-1", companyId: "company-1", alertEventId: "event-1" }]);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S14 rejects model-boundary fields and missing idempotency", async () => {
  let called = false;
  const server = await listen({ generate: async () => { called = true; } });
  try {
    const forbidden = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/alerts/event-1/direct-blurb`, { method: "POST", headers, body: JSON.stringify({ recipient_id: "user-1", subject: "Do not pass" }) });
    assert.equal(forbidden.status, 400);
    assert.equal(called, false);
    const noKey = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/alerts/event-1/direct-blurb`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noKey.status, 400);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
