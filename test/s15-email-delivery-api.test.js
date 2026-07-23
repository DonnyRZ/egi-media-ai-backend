const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createAlertRouter } = require("../src/routes/alerts");

function listen(service) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1" }, tenantId: "tenant-1", companyId: "company-1", scopeTrusted: true }; next(); });
  app.use(createAlertRouter({ getEmailDeliveryService: () => service, getAlertRuntime: () => ({}) }));
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const headers = { "Content-Type": "application/json", "Idempotency-Key": "email-delivery-api-001" };

test("S15 delivers through backend adapter and returns audit-safe status", async () => {
  const calls = [];
  const server = await listen({ deliver: async (input) => { calls.push(input); return { reused: false, delivery: { deliveryId: "delivery-1", alertEventId: "event-1", status: "sent", subject: "must not leak", recipientEmailHash: "hash", attempts: [{ attempt: 1, outcome: "sent", errorCode: null, at: "2026-07-23T00:00:00.000Z" }] } }; } });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/alerts/event-1/deliver`, { method: "POST", headers, body: "{}" });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.email_send, true);
    assert.equal(body.data.delivery.status, "sent");
    assert.equal(Object.hasOwn(body.data.delivery, "subject"), false);
    assert.equal(Object.hasOwn(body.data.delivery, "recipient_email_hash"), false);
    assert.deepEqual(calls, [{ tenantId: "tenant-1", companyId: "company-1", alertEventId: "event-1" }]);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S15 does not accept recipient or subject overrides", async () => {
  let called = false;
  const server = await listen({ deliver: async () => { called = true; } });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/alerts/event-1/deliver`, { method: "POST", headers, body: JSON.stringify({ recipient_id: "attacker", subject: "override" }) });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
