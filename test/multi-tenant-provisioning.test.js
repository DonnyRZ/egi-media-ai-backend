const test = require("node:test");
const assert = require("node:assert/strict");
process.env.APP_PORT = "0";
require("./support/test-env");
const Server = require("../src/app/server");

async function request(base, path, options = {}) { const response = await fetch(`${base}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } }); return { response, body: await response.json() }; }
function json(value) { return JSON.stringify(value); }

test("generic tenant provisioning never requires an EGI company and can issue a customer-scoped session", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = `customer-acme-${suffix}`;
  const companyId = `acme-main-${suffix}`;
  const ownerEmail = `owner-${suffix}@acme.example`;
  const server = new Server(); const listener = await server.listen(); const base = `http://localhost:${listener.address().port}`;
  try {
    const login = await request(base, "/api/v1/auth/login", { method: "POST", body: json({ email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: process.env.BOOTSTRAP_ADMIN_PASSWORD }) });
    assert.equal(login.response.status, 200); const platformToken = login.body.data.access_token;
    const headers = { Authorization: `Bearer ${platformToken}`, "Idempotency-Key": `tenant-provisioning-${suffix}` };
    const tenant = await request(base, "/api/v1/platform/tenants", { method: "POST", headers, body: json({ tenant_id: tenantId, name: "Acme Customer", status: "active" }) });
    assert.equal(tenant.response.status, 201); assert.equal(tenant.body.data.tenant.tenant_id, tenantId);
    const company = await request(base, `/api/v1/platform/tenants/${tenantId}/companies`, { method: "POST", headers: { ...headers, "Idempotency-Key": `company-provisioning-${suffix}` }, body: json({ company_id: companyId, name: "Acme Main", status: "active" }) });
    assert.equal(company.response.status, 201); assert.equal(company.body.data.company.tenant_id, tenantId);
    const owner = await request(base, `/api/v1/platform/tenants/${tenantId}/owner`, { method: "POST", headers: { ...headers, "Idempotency-Key": `owner-provisioning-${suffix}` }, body: json({ email: ownerEmail, full_name: "Acme Owner", company_id: companyId }) });
    assert.equal(owner.response.status, 201); assert.equal(owner.body.data.membership.role, "tenant_owner");
    const signup = await request(base, "/api/v1/auth/signup", { method: "POST", body: json({ email: ownerEmail, full_name: "Acme Owner", password: "AcmeOwner123!" }) });
    assert.equal(signup.response.status, 201);
    const customerLogin = await request(base, "/api/v1/auth/login", { method: "POST", body: json({ email: ownerEmail, password: "AcmeOwner123!" }) });
    assert.equal(customerLogin.response.status, 200); assert.equal(customerLogin.body.data.tenant_id, tenantId); assert.equal(customerLogin.body.data.company_id, companyId);
    const companies = await request(base, "/api/v1/companies", { headers: { Authorization: `Bearer ${customerLogin.body.data.access_token}` } });
    assert.equal(companies.response.status, 200); assert.deepEqual(companies.body.data.items.map((item) => item.company_id), [companyId]);
    assert.equal(companies.body.data.items[0].tenant_id, tenantId);
    assert.equal(companies.body.data.items[0].name, "Acme Main");
    assert.ok(Array.isArray(customerLogin.body.data.authorized_companies));
    assert.equal(customerLogin.body.data.authorized_companies[0]?.company_id, companyId);
    assert.equal(customerLogin.body.data.authorized_companies[0]?.tenant_id, tenantId);
    assert.equal(customerLogin.body.data.authorized_companies[0]?.name, "Acme Main");
  } finally { await server.stop(); }
});
