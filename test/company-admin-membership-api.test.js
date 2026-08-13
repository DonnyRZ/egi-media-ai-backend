const test = require("node:test");
const assert = require("node:assert/strict");

process.env.APP_PORT = "0";
process.env.AI_LOCAL_PREVIEW_AUTH = "true";
require("./support/test-env");
const Server = require("../src/app/server");

const authHeaders = {
  Authorization: "Bearer dummy-bearer-token-for-local-ui",
  "Content-Type": "application/json",
};

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...authHeaders, ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

test("company admin access API is scoped to the active company", async () => {
  const server = new Server();
  server.app.locals.membershipStore.upsert({ membershipId: "membership-company-admin", userId: "dummy-actor", tenantId: "dummy-tenant", companyId: "company-a", role: "company_admin" });
  server.app.locals.membershipStore.upsert({ membershipId: "membership-company-analyst", userId: "user:analyst@example.com", tenantId: "dummy-tenant", companyId: "company-a", role: "analyst", version: 2 });
  server.app.locals.membershipStore.upsert({ membershipId: "membership-company-b", userId: "user:other@example.com", tenantId: "dummy-tenant", companyId: "company-b", role: "viewer" });
  server.app.locals.membershipStore.upsert({ membershipId: "membership-tenant-viewer", userId: "user:tenant@example.com", tenantId: "dummy-tenant", companyId: null, role: "viewer" });
  const listener = await server.listen();
  const base = `http://localhost:${listener.address().port}`;
  try {
    const list = await request(base, "/api/v1/company/memberships");
    assert.equal(list.response.status, 200);
    assert.deepEqual(list.body.data.items.map((item) => item.membership_id), ["membership-company-admin", "membership-company-analyst"]);
    assert.ok(list.body.data.items.every((item) => item.company_id === "company-a"));

    const created = await request(base, "/api/v1/company/memberships", {
      method: "POST",
      headers: { "Idempotency-Key": "company-member-invite-0001" },
      body: JSON.stringify({ email: "reviewer@example.com", full_name: "Company Reviewer", password: "ReviewerPass123!", role: "reviewer" }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.membership.company_id, "company-a");

    const attemptedTenantMembership = await request(base, "/api/v1/company/memberships", {
      method: "POST",
      headers: { "Idempotency-Key": "company-member-invite-0002" },
      body: JSON.stringify({ email: "tenant@example.com", role: "viewer", company_id: null }),
    });
    assert.equal(attemptedTenantMembership.response.status, 403);

    const updated = await request(base, "/api/v1/company/memberships/membership-company-analyst", {
      method: "PATCH",
      headers: { "Idempotency-Key": "company-member-update-0001", "If-Match": "2" },
      body: JSON.stringify({ role: "executive_viewer" }),
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.membership.role, "executive_viewer");
    assert.equal(updated.body.data.membership.company_id, "company-a");

    const revoked = await request(base, `/api/v1/company/memberships/${created.body.data.membership.membership_id}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": "company-member-revoke-0001", "If-Match": "1" },
    });
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.body.data.membership.status, "revoked");

    const crossCompanyUpdate = await request(base, "/api/v1/company/memberships/membership-company-b", {
      method: "PATCH",
      headers: { "Idempotency-Key": "company-member-update-0002", "If-Match": "1" },
      body: JSON.stringify({ role: "reviewer" }),
    });
    assert.equal(crossCompanyUpdate.response.status, 403);

    const crossCompanyDelete = await request(base, "/api/v1/company/memberships/membership-tenant-viewer", {
      method: "DELETE",
      headers: { "Idempotency-Key": "company-member-revoke-0002", "If-Match": "1" },
    });
    assert.equal(crossCompanyDelete.response.status, 403);

    const tenantRoute = await request(base, "/api/v1/tenant/memberships");
    assert.equal(tenantRoute.response.status, 403);
  } finally {
    await server.stop();
  }
});
