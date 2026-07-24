const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createAlertRouter } = require("../src/routes/alerts");
const { InMemoryAlertPreferenceStore } = require("../src/alerts/alert-preference.store");

const scope = { tenantId: "tenant-1", companyId: "company-1" };
function listen(runtime) { const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1" }, ...scope, scopeTrusted: true }; next(); }); app.use(createAlertRouter({ getAlertRuntime: () => runtime })); const server = http.createServer(app); return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server))); }
const headers = { "Content-Type": "application/json", "Idempotency-Key": "alert-api-key-001" };

test("S13 stores preference and returns rules-only eligibility decision", async () => {
  const calls = []; const runtime = { preferenceStore: new InMemoryAlertPreferenceStore(), service: { evaluate: async (input) => { calls.push(input); return { decision: { channel: "none", status: "suppressed", reasonCode: "material_update_unresolved" } }; } } };
  const server = await listen(runtime); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const pref = await fetch(`${base}/api/v1/companies/company-1/alert-preference`, { method: "PUT", headers, body: JSON.stringify({ recipient_id: "user-1", direct_high_enabled: true, daily_digest_enabled: true, timezone: "Asia/Jakarta", quiet_hours: { start: "22:00", end: "07:00" } }) });
    const eligibility = await fetch(`${base}/api/v1/internal/alerts/eligibility`, { method: "POST", headers, body: JSON.stringify({ tenant_id: scope.tenantId, company_id: scope.companyId, issue_id: "issue-1", development_id: "development-1", recipient_id: "user-1" }) });
    assert.equal(pref.status, 200); assert.equal(eligibility.status, 200); assert.equal((await eligibility.json()).data.decision.reason_code, "material_update_unresolved"); assert.equal(calls.length, 1); assert.equal((await pref.json()).data.timezone, "Asia/Jakarta");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S13 does not send email and enforces scope/idempotency gates", async () => {
  let evaluated = false; const server = await listen({ preferenceStore: new InMemoryAlertPreferenceStore(), service: { evaluate: async () => { evaluated = true; } } });
  try {
    const noKey = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/alerts/eligibility`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scope }) }); assert.equal(noKey.status, 400);
    const crossScope = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/alerts/eligibility`, { method: "POST", headers, body: JSON.stringify({ tenant_id: "tenant-1", company_id: "company-2" }) }); assert.equal(crossScope.status, 403); assert.equal(evaluated, false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
