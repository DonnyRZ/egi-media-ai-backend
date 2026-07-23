const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createAlertRouter } = require("../../src/routes/alerts");
const { createHealthHandlers } = require("../../src/app/health");
const { InMemoryAlertEventStore } = require("../../src/alerts");
const { openTestDatabase, testDatabaseUrl } = require("../helpers/test-database");

const skip = !process.env.RUN_DATABASE_INTEGRATION_TESTS || !testDatabaseUrl();
const scope = { tenantId: "s23-tenant", companyId: "s23-company" };
const headers = { "Content-Type": "application/json", "Idempotency-Key": "s23-db-api-key-0001" };

function appFor(db, runtime) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.get("X-Test-Auth") !== "false") req.authContext = { actor: { actorId: "s23-human", actorType: "human" }, ...scope, scopeTrusted: true }; next(); });
  const health = createHealthHandlers({ env: process.env, getDatabaseRuntime: () => ({ source: { healthCheck: async () => true }, ai: { healthCheck: async () => db.query("SELECT 1").then(() => true) } }) });
  app.get("/health/ready", health.ready); app.use(createAlertRouter({ getAlertRuntime: () => runtime })); return http.createServer(app);
}

test("S23 database-backed API covers auth, tenant/company scope, validation, and idempotency header", { skip }, async () => {
  const db = await openTestDatabase(); const preferenceStore = { upsert: async ({ tenantId, companyId, recipientId, directHighEnabled, dailyDigestEnabled, timezone, quietHours }) => { await db.query("INSERT INTO ai.alert_preferences (id, tenant_id, company_id, user_ref, direct_high_enabled, daily_digest_enabled, timezone, quiet_hours_jsonb) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (company_id,user_ref) DO UPDATE SET direct_high_enabled=EXCLUDED.direct_high_enabled, daily_digest_enabled=EXCLUDED.daily_digest_enabled, timezone=EXCLUDED.timezone, quiet_hours_jsonb=EXCLUDED.quiet_hours_jsonb", [`s23-${tenantId}-${companyId}-${recipientId}`, tenantId, companyId, recipientId, directHighEnabled, dailyDigestEnabled, timezone, JSON.stringify(quietHours)]); return { recipientId, directHighEnabled, dailyDigestEnabled, timezone, quietHours }; } };
  const runtime = { preferenceStore, service: { evaluate: async () => ({ decision: new InMemoryAlertEventStore().create({ ...scope, issueId: "issue-1", developmentId: "development-1", recipientId: "user-1", channel: "none", status: "suppressed", reasonCode: "test", dedupeKey: "s23-test" }) }) } };
  const server = appFor(db, runtime); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const ready = await fetch(`http://127.0.0.1:${server.address().port}/health/ready`); assert.equal(ready.status, 200);
    const missingAuth = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/companies/${scope.companyId}/alert-preference`, { method: "PUT", headers: { ...headers, "X-Test-Auth": "false" }, body: JSON.stringify({ recipient_id: "user-1", direct_high_enabled: true, daily_digest_enabled: true, timezone: "Asia/Jakarta", quiet_hours: null }) }); assert.equal(missingAuth.status, 401);
    const invalid = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/companies/${scope.companyId}/alert-preference`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient_id: "user-1" }) }); assert.equal(invalid.status, 400);
    const saved = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/companies/${scope.companyId}/alert-preference`, { method: "PUT", headers, body: JSON.stringify({ recipient_id: "user-1", direct_high_enabled: true, daily_digest_enabled: true, timezone: "Asia/Jakarta", quiet_hours: null }) }); assert.equal(saved.status, 200);
    const repeated = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/companies/${scope.companyId}/alert-preference`, { method: "PUT", headers, body: JSON.stringify({ recipient_id: "user-1", direct_high_enabled: true, daily_digest_enabled: true, timezone: "Asia/Jakarta", quiet_hours: null }) }); assert.equal(repeated.status, 200);
    const row = await db.query("SELECT tenant_id, company_id, user_ref FROM ai.alert_preferences WHERE tenant_id=$1 AND company_id=$2 AND user_ref=$3", [scope.tenantId, scope.companyId, "user-1"]); assert.equal(row.rows.length, 1); assert.equal(row.rows[0].company_id, scope.companyId);
    const crossCompany = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/companies/company-other/alert-preference`, { method: "PUT", headers, body: JSON.stringify({ recipient_id: "user-1", direct_high_enabled: true, daily_digest_enabled: true, timezone: "Asia/Jakarta", quiet_hours: null }) }); assert.equal(crossCompany.status, 403);
  } finally { await db.query("DELETE FROM ai.alert_preferences WHERE tenant_id=$1", [scope.tenantId]); await new Promise((resolve) => server.close(resolve)); await db.close(); }
});
