const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createCompanyRouter } = require("../src/routes/companies");
const { InMemoryCompanyStore } = require("../src/auth/provisioning.store");
const { resolveCompanyLanguage } = require("../src/language/company-language");

const scope = { tenantId: "tenant-1", companyId: "company-1" };

function listen(companyStore) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authContext = { actor: { actorId: "actor-1", actorType: "human" }, ...scope, scopeTrusted: true };
    next();
  });
  app.use(createCompanyRouter({ getCompanyStore: () => companyStore }));
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const headers = { "Content-Type": "application/json", "Idempotency-Key": "language-api-key-001" };

test("company-language resolves null and unsupported locales to id", () => {
  assert.equal(resolveCompanyLanguage(null), "id");
  assert.equal(resolveCompanyLanguage("en"), "en");
  assert.equal(resolveCompanyLanguage("uz"), "id");
});

test("language preference GET defaults to id and PATCH persists en/id", async () => {
  const companyStore = new InMemoryCompanyStore({
    companies: [{ tenantId: scope.tenantId, companyId: scope.companyId, name: "Acme", locale: null, status: "active" }],
  });
  const server = await listen(companyStore);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const initial = await fetch(`${base}/api/v1/companies/company-1/language-preference`);
    assert.equal(initial.status, 200);
    assert.equal((await initial.json()).data.language, "id");

    const toEn = await fetch(`${base}/api/v1/companies/company-1/language-preference`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ language: "en" }),
    });
    assert.equal(toEn.status, 200);
    assert.equal((await toEn.json()).data.language, "en");

    const afterEn = await fetch(`${base}/api/v1/companies/company-1/language-preference`);
    assert.equal(afterEn.status, 200);
    assert.equal((await afterEn.json()).data.language, "en");

    const toId = await fetch(`${base}/api/v1/companies/company-1/language-preference`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ language: "id" }),
    });
    assert.equal(toId.status, 200);
    assert.equal((await toId.json()).data.language, "id");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("language preference enforces validation, scope, and idempotency", async () => {
  const companyStore = new InMemoryCompanyStore({
    companies: [{ tenantId: scope.tenantId, companyId: scope.companyId, name: "Acme", locale: null, status: "active" }],
  });
  const server = await listen(companyStore);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const invalid = await fetch(`${base}/api/v1/companies/company-1/language-preference`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ language: "uz" }),
    });
    assert.equal(invalid.status, 400);

    const crossCompany = await fetch(`${base}/api/v1/companies/company-2/language-preference`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ language: "en" }),
    });
    assert.equal(crossCompany.status, 403);

    const noKey = await fetch(`${base}/api/v1/companies/company-1/language-preference`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "en" }),
    });
    assert.equal(noKey.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
