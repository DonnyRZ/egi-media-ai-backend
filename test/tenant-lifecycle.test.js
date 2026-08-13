const test = require("node:test");
const assert = require("node:assert/strict");

process.env.APP_PORT = "0";
require("./support/test-env");
const Server = require("../src/app/server");

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

function json(value) { return JSON.stringify(value); }

test("platform tenant lifecycle is explicit, auditable, and blocks suspended customer access", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = `lifecycle-${suffix}`;
  const companyId = `lifecycle-company-${suffix}`;
  const ownerEmail = `lifecycle-owner-${suffix}@example.test`;
  const server = new Server();
  const listener = await server.listen();
  const base = `http://localhost:${listener.address().port}`;
  try {
    const login = await request(base, "/api/v1/auth/login", { method: "POST", body: json({ email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: process.env.BOOTSTRAP_ADMIN_PASSWORD }) });
    assert.equal(login.response.status, 200);
    const platformToken = login.body.data.access_token;
    const auth = { Authorization: `Bearer ${platformToken}` };
    const createHeaders = { ...auth, "Idempotency-Key": `lifecycle-create-${suffix}` };

    const created = await request(base, "/api/v1/platform/tenants", { method: "POST", headers: createHeaders, body: json({ tenant_id: tenantId, name: "Lifecycle Customer", status: "active" }) });
    assert.equal(created.response.status, 201);
    const company = await request(base, `/api/v1/platform/tenants/${tenantId}/companies`, { method: "POST", headers: { ...auth, "Idempotency-Key": `lifecycle-company-${suffix}` }, body: json({ company_id: companyId, name: "Lifecycle Company", status: "active" }) });
    assert.equal(company.response.status, 201);
    const owner = await request(base, `/api/v1/platform/tenants/${tenantId}/owner`, { method: "POST", headers: { ...auth, "Idempotency-Key": `lifecycle-owner-${suffix}` }, body: json({ email: ownerEmail, full_name: "Lifecycle Owner", password: "LifecycleOwner123!", company_id: companyId }) });
    assert.equal(owner.response.status, 201);
    const customerLogin = await request(base, "/api/v1/auth/login", { method: "POST", body: json({ email: ownerEmail, password: "LifecycleOwner123!" }) });
    assert.equal(customerLogin.response.status, 200);
    const customerToken = customerLogin.body.data.access_token;

    const customerCannotChangeLifecycle = await request(base, `/api/v1/platform/tenants/${tenantId}`, { method: "PATCH", headers: { Authorization: `Bearer ${customerToken}`, "Idempotency-Key": `lifecycle-customer-denied-${suffix}` }, body: json({ status: "suspended", reason: "Customer should not mutate platform lifecycle" }) });
    assert.equal(customerCannotChangeLifecycle.response.status, 403);

    const archiveTooSoon = await request(base, `/api/v1/platform/tenants/${tenantId}`, { method: "PATCH", headers: { ...auth, "Idempotency-Key": `lifecycle-archive-too-soon-${suffix}` }, body: json({ status: "archived", reason: "Customer offboarding" }) });
    assert.equal(archiveTooSoon.response.status, 409);
    assert.equal(archiveTooSoon.body.error.code, "TENANT_STATUS_TRANSITION_INVALID");

    const suspended = await request(base, `/api/v1/platform/tenants/${tenantId}`, { method: "PATCH", headers: { ...auth, "Idempotency-Key": `lifecycle-suspend-${suffix}` }, body: json({ status: "suspended", reason: "Subscription payment overdue" }) });
    assert.equal(suspended.response.status, 200);
    assert.equal(suspended.body.data.tenant.status, "suspended");
    assert.equal(suspended.body.data.previous_status, "active");
    assert.equal(suspended.body.data.lifecycle_changed, true);

    const blockedSession = await request(base, "/api/v1/auth/session", { headers: { Authorization: `Bearer ${customerToken}` } });
    assert.equal(blockedSession.response.status, 403);
    assert.equal(blockedSession.body.error.code, "TENANT_NOT_ACTIVE");
    const blockedLogin = await request(base, "/api/v1/auth/login", { method: "POST", body: json({ email: ownerEmail, password: "LifecycleOwner123!" }) });
    assert.equal(blockedLogin.response.status, 403);
    assert.equal(blockedLogin.body.error.code, "TENANT_NOT_ACTIVE");

    const archived = await request(base, `/api/v1/platform/tenants/${tenantId}`, { method: "PATCH", headers: { ...auth, "Idempotency-Key": `lifecycle-archive-${suffix}` }, body: json({ status: "archived", reason: "Customer did not renew" }) });
    assert.equal(archived.response.status, 200);
    assert.equal(archived.body.data.tenant.status, "archived");

    const restored = await request(base, `/api/v1/platform/tenants/${tenantId}`, { method: "PATCH", headers: { ...auth, "Idempotency-Key": `lifecycle-restore-${suffix}` }, body: json({ status: "active", reason: "Customer renewed" }) });
    assert.equal(restored.response.status, 200);
    assert.equal(restored.body.data.tenant.status, "active");

    const audit = await request(base, "/api/v1/platform/audit-events", { headers: auth });
    assert.equal(audit.response.status, 200);
    const lifecycleEvents = audit.body.data.items.filter((item) => item.action === "tenant.lifecycle.change" && item.tenant_id === tenantId);
    assert.equal(lifecycleEvents.length, 3);
    const suspendedEvent = lifecycleEvents.find((item) => item.metadata?.nextStatus === "suspended");
    assert.ok(suspendedEvent);
    assert.equal(suspendedEvent.metadata.reason, "Subscription payment overdue");
  } finally {
    await server.stop();
  }
});
