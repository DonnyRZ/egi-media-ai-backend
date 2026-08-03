const test = require("node:test");
const assert = require("node:assert/strict");
process.env.APP_PORT = "0";
process.env.AI_LOCAL_PREVIEW_AUTH = "true";
require("./support/test-env");
const Server = require("../src/app/server");

test("tenant membership API is backend-scoped and supports invite/revoke lifecycle", async () => {
  const server = new Server(); server.app.locals.membershipStore.upsert({ userId: "dummy-actor", tenantId: "dummy-tenant", companyId: null, role: "tenant_admin" }); const listener = await server.listen(); const base = `http://localhost:${listener.address().port}`;
  const headers = { Authorization: "Bearer dummy-bearer-token-for-local-ui", "Content-Type": "application/json" };
  try {
    const list = await fetch(`${base}/api/v1/tenant/memberships`, { headers }); assert.equal(list.status, 200);
    const created = await fetch(`${base}/api/v1/tenant/memberships`, { method: "POST", headers: { ...headers, "Idempotency-Key": "membership-invite-0001" }, body: JSON.stringify({ email: "analyst@example.com", role: "analyst", company_id: "company-a" }) });
    assert.equal(created.status, 201); const body = await created.json(); const membership = body.data.membership;
    const repeated = await fetch(`${base}/api/v1/tenant/memberships`, { method: "POST", headers: { ...headers, "Idempotency-Key": "membership-invite-0002" }, body: JSON.stringify({ email: "analyst@example.com", role: "viewer", company_id: "company-a" }) });
    assert.equal(repeated.status, 200); const repeatedBody = await repeated.json(); const repeatedMembership = repeatedBody.data.membership; assert.equal(repeatedBody.data.reused, true); assert.equal(repeatedMembership.version, membership.version + 1);
    const revoked = await fetch(`${base}/api/v1/tenant/memberships/${membership.membership_id}`, { method: "DELETE", headers: { ...headers, "Idempotency-Key": "membership-revoke-0001", "If-Match": String(repeatedMembership.version) } });
    assert.equal(revoked.status, 200); assert.equal((await revoked.json()).data.membership.status, "revoked");
  } finally { await server.stop(); }
});

test("platform tenant API is unavailable to customer roles", async () => {
  const server = new Server(); const listener = await server.listen(); const base = `http://localhost:${listener.address().port}`; const headers = { Authorization: "Bearer dummy-bearer-token-for-local-ui" };
  try { const response = await fetch(`${base}/api/v1/platform/tenants`, { headers }); assert.equal(response.status, 403); } finally { await server.stop(); }
});
