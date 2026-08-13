const test = require("node:test");
const assert = require("node:assert/strict");
process.env.APP_PORT = "0";
require("./support/test-env");
const Server = require("../src/app/server");

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  return { response, body: await response.json() };
}
function json(value) { return JSON.stringify(value); }

test("admin-provisioned owner can sign in without public signup", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = `provision-${suffix}`;
  const companyId = `provision-co-${suffix}`;
  const ownerEmail = `owner-${suffix}@example.test`;
  const server = new Server();
  const listener = await server.listen();
  const base = `http://localhost:${listener.address().port}`;
  try {
    const login = await request(base, "/api/v1/auth/login", { method: "POST", body: json({ email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: process.env.BOOTSTRAP_ADMIN_PASSWORD }) });
    assert.equal(login.response.status, 200);
    const headers = { Authorization: `Bearer ${login.body.data.access_token}` };
    await request(base, "/api/v1/platform/tenants", { method: "POST", headers: { ...headers, "Idempotency-Key": `provision-tenant-${suffix}` }, body: json({ tenant_id: tenantId, name: "Provision Customer", status: "active" }) });
    await request(base, `/api/v1/platform/tenants/${tenantId}/companies`, { method: "POST", headers: { ...headers, "Idempotency-Key": `provision-company-${suffix}` }, body: json({ company_id: companyId, name: "Provision Company", status: "active" }) });

    const missingPassword = await request(base, `/api/v1/platform/tenants/${tenantId}/owner`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": `provision-owner-missing-${suffix}` },
      body: json({ email: ownerEmail, full_name: "Provision Owner", company_id: companyId }),
    });
    assert.equal(missingPassword.response.status, 400);

    const owner = await request(base, `/api/v1/platform/tenants/${tenantId}/owner`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": `provision-owner-${suffix}` },
      body: json({ email: ownerEmail, full_name: "Provision Owner", password: "ProvisionOwner123!", company_id: companyId }),
    });
    assert.equal(owner.response.status, 201);
    assert.equal(owner.body.data.membership.status, "active");
    assert.equal(owner.body.data.membership.role, "tenant_owner");

    const signup = await request(base, "/api/v1/auth/signup", { method: "POST", body: json({ email: `other-${suffix}@example.test`, full_name: "Other", password: "OtherPass123!" }) });
    assert.equal(signup.response.status, 410);
    assert.equal(signup.body.error.code, "SIGNUP_DISABLED");

    const customerLogin = await request(base, "/api/v1/auth/login", { method: "POST", body: json({ email: ownerEmail, password: "ProvisionOwner123!" }) });
    assert.equal(customerLogin.response.status, 200);
    assert.equal(customerLogin.body.data.actor.role, "tenant_owner");
    assert.equal(customerLogin.body.data.tenant_id, tenantId);

    const analystEmail = `analyst-${suffix}@example.test`;
    const invited = await request(base, "/api/v1/tenant/memberships", {
      method: "POST",
      headers: { Authorization: `Bearer ${customerLogin.body.data.access_token}`, "Idempotency-Key": `provision-analyst-${suffix}` },
      body: json({ email: analystEmail, full_name: "Provision Analyst", password: "AnalystPass123!", role: "analyst", company_id: companyId }),
    });
    assert.equal(invited.response.status, 201);
    assert.equal(invited.body.data.membership.status, "active");
    const analystLogin = await request(base, "/api/v1/auth/login", { method: "POST", body: json({ email: analystEmail, password: "AnalystPass123!" }) });
    assert.equal(analystLogin.response.status, 200);
    assert.equal(analystLogin.body.data.actor.role, "analyst");
  } finally {
    await server.stop();
  }
});
