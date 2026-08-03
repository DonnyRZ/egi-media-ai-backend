const test = require("node:test");
const assert = require("node:assert/strict");

process.env.APP_PORT = "0";
process.env.AI_LOCAL_PREVIEW_AUTH = "true";
require("./support/test-env");
const Server = require("../src/app/server");

test("platform and tenant audit APIs expose safe scoped operational data", async () => {
  const server = new Server();
  await server.app.locals.platformStore.upsert({ userId: "dummy-actor", role: "platform_superadmin" });
  await server.app.locals.accessAuditStore.record({ actorId: "dummy-actor", actorType: "human", action: "test.operation", outcome: "allowed", metadata: { safe: true } });
  const listener = await server.listen();
  const base = `http://localhost:${listener.address().port}`;
  const headers = { Authorization: "Bearer dummy-bearer-token-for-local-ui" };
  try {
    const health = await fetch(`${base}/api/v1/platform/health`, { headers });
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.data.service, "egi-media-ai-backend");
    assert.ok(["ready", "degraded"].includes(healthBody.data.status));
    assert.equal(typeof healthBody.data.checks.environment, "string");
    assert.equal(Object.hasOwn(healthBody.data, "openai_api_key"), false);

    const audit = await fetch(`${base}/api/v1/platform/audit-events?action=test.operation&limit=10`, { headers });
    assert.equal(audit.status, 200);
    const auditBody = await audit.json();
    assert.equal(auditBody.data.items[0].action, "test.operation");
    assert.equal(auditBody.data.items[0].metadata.safe, true);

    await server.app.locals.accessAuditStore.record({ actorId: "dummy-actor", actorType: "human", tenantId: "dummy-tenant", action: "tenant.test", outcome: "allowed", metadata: { tenantSafe: true } });
    const tenantAudit = await fetch(`${base}/api/v1/tenant/audit-events?action=tenant.test&limit=10`, { headers });
    assert.equal(tenantAudit.status, 200);
    const tenantAuditBody = await tenantAudit.json();
    assert.equal(tenantAuditBody.data.items[0].action, "tenant.test");
    assert.equal(tenantAuditBody.data.items[0].metadata.tenantSafe, true);
  } finally {
    await server.stop();
  }
});

test("platform operational APIs reject a customer actor", async () => {
  const server = new Server();
  const listener = await server.listen();
  const base = `http://localhost:${listener.address().port}`;
  const headers = { Authorization: "Bearer dummy-bearer-token-for-local-ui" };
  try {
    const response = await fetch(`${base}/api/v1/platform/audit-events`, { headers });
    assert.equal(response.status, 403);
  } finally {
    await server.stop();
  }
});
