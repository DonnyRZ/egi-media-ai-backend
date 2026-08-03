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
    const secondCompanyId = `acme-second-${suffix}`;
    const secondCompany = await request(base, "/api/v1/tenant/companies", {
      method: "POST",
      headers: { Authorization: `Bearer ${customerLogin.body.data.access_token}`, "Idempotency-Key": `tenant-company-${suffix}` },
      body: json({ company_id: secondCompanyId, name: "Acme Second", status: "active" }),
    });
    assert.equal(secondCompany.response.status, 201);

    const registry = await request(base, "/api/v1/tenant/companies", {
      headers: { Authorization: `Bearer ${customerLogin.body.data.access_token}` },
    });
    assert.equal(registry.response.status, 200);
    assert.deepEqual(registry.body.data.items.map((item) => item.company_id), [secondCompanyId, companyId]);

    const expandedCompanies = await request(base, "/api/v1/companies", { headers: { Authorization: `Bearer ${customerLogin.body.data.access_token}` } });
    assert.equal(expandedCompanies.response.status, 200);
    assert.deepEqual(expandedCompanies.body.data.items.map((item) => item.company_id), [secondCompanyId, companyId]);

    const switched = await request(base, "/api/v1/auth/switch-context", {
      method: "POST",
      headers: { Authorization: `Bearer ${customerLogin.body.data.access_token}` },
      body: json({ tenant_id: tenantId, company_id: secondCompanyId }),
    });
    assert.equal(switched.response.status, 200);
    assert.equal(switched.body.data.company_name, "Acme Second");

    const session = await request(base, "/api/v1/auth/session", { headers: { Authorization: `Bearer ${switched.body.data.access_token}` } });
    assert.equal(session.response.status, 200);
    assert.deepEqual(session.body.data.authorized_companies.map((item) => item.company_id), [secondCompanyId, companyId]);

    const adminEmail = `admin-${suffix}@acme.example`;
    const invitedAdmin = await request(base, "/api/v1/tenant/memberships", {
      method: "POST",
      headers: { Authorization: `Bearer ${customerLogin.body.data.access_token}`, "Idempotency-Key": `tenant-admin-${suffix}` },
      body: json({ email: adminEmail, full_name: "Acme Tenant Admin", role: "tenant_admin" }),
    });
    assert.equal(invitedAdmin.response.status, 201);
    assert.equal(invitedAdmin.body.data.membership.company_id, null);
    assert.equal(invitedAdmin.body.data.membership.role, "tenant_admin");
    const adminSignup = await request(base, "/api/v1/auth/signup", { method: "POST", body: json({ email: adminEmail, full_name: "Acme Tenant Admin", password: "AcmeTenantAdmin123!" }) });
    assert.equal(adminSignup.response.status, 201);
    const adminLogin = await request(base, "/api/v1/auth/login", { method: "POST", body: json({ email: adminEmail, password: "AcmeTenantAdmin123!" }) });
    assert.equal(adminLogin.response.status, 200);
    assert.equal(adminLogin.body.data.actor.role, "tenant_admin");
    assert.equal(adminLogin.body.data.tenant_id, tenantId);
    assert.equal(adminLogin.body.data.company_id, null);
    assert.ok(adminLogin.body.data.permissions.includes("tenant.companies.manage"));
    assert.deepEqual(adminLogin.body.data.authorized_companies.map((item) => item.company_id), [secondCompanyId, companyId]);
    const adminSession = await request(base, "/api/v1/auth/session", { headers: { Authorization: `Bearer ${adminLogin.body.data.access_token}` } });
    assert.equal(adminSession.response.status, 200);
    assert.equal(adminSession.body.data.role, "tenant_admin");
    assert.equal(adminSession.body.data.company_id, null);
    const adminSwitched = await request(base, "/api/v1/auth/switch-context", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminLogin.body.data.access_token}` },
      body: json({ tenant_id: tenantId, company_id: secondCompanyId }),
    });
    assert.equal(adminSwitched.response.status, 200);
    assert.equal(adminSwitched.body.data.role, "tenant_admin");

    const companyAdminEmail = `company-admin-${suffix}@acme.example`;
    const invitedCompanyAdmin = await request(base, "/api/v1/tenant/memberships", {
      method: "POST",
      headers: { Authorization: `Bearer ${customerLogin.body.data.access_token}`, "Idempotency-Key": `company-admin-${suffix}` },
      body: json({ email: companyAdminEmail, full_name: "Acme Company Admin", company_id: companyId, role: "company_admin" }),
    });
    assert.equal(invitedCompanyAdmin.response.status, 201);
    assert.equal(invitedCompanyAdmin.body.data.membership.company_id, companyId);
    assert.equal(invitedCompanyAdmin.body.data.membership.role, "company_admin");
    const companyAdminSignup = await request(base, "/api/v1/auth/signup", { method: "POST", body: json({ email: companyAdminEmail, full_name: "Acme Company Admin", password: "AcmeCompanyAdmin123!" }) });
    assert.equal(companyAdminSignup.response.status, 201);
    const companyAdminLogin = await request(base, "/api/v1/auth/login", { method: "POST", body: json({ email: companyAdminEmail, password: "AcmeCompanyAdmin123!" }) });
    assert.equal(companyAdminLogin.response.status, 200);
    assert.equal(companyAdminLogin.body.data.actor.role, "company_admin");
    assert.deepEqual(companyAdminLogin.body.data.authorized_companies.map((item) => item.company_id), [companyId]);
    const companyAdminCompanies = await request(base, "/api/v1/companies", { headers: { Authorization: `Bearer ${companyAdminLogin.body.data.access_token}` } });
    assert.equal(companyAdminCompanies.response.status, 200);
    assert.deepEqual(companyAdminCompanies.body.data.items.map((item) => item.company_id), [companyId]);
    const companyAdminSession = await request(base, "/api/v1/auth/session", { headers: { Authorization: `Bearer ${companyAdminLogin.body.data.access_token}` } });
    assert.equal(companyAdminSession.response.status, 200);
    assert.equal(companyAdminSession.body.data.role, "company_admin");
    assert.deepEqual(companyAdminSession.body.data.authorized_companies.map((item) => item.company_id), [companyId]);
    const unauthorizedSwitch = await request(base, "/api/v1/auth/switch-context", {
      method: "POST",
      headers: { Authorization: `Bearer ${companyAdminLogin.body.data.access_token}` },
      body: json({ tenant_id: tenantId, company_id: secondCompanyId }),
    });
    assert.equal(unauthorizedSwitch.response.status, 403);
  } finally { await server.stop(); }
});
