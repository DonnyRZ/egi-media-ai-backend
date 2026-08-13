const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  isEvalTenantId,
  resolveWorkerTenantPolicy,
  filterEligibleScopes,
} = require("../src/automation/worker-tenant-policy");

describe("worker tenant policy", () => {
  it("detects eval tenant ids", () => {
    assert.equal(isEvalTenantId("eval-tenant-eval-20260801-abc"), true);
    assert.equal(isEvalTenantId("eval-tenant-canary-20260801-reviewv2"), true);
    assert.equal(isEvalTenantId("acme-holding-demo"), false);
  });

  it("fail-closes production workers without allowlist", () => {
    assert.throws(
      () => resolveWorkerTenantPolicy({
        APP_ENV: "production",
        AI_WORKERS_ENABLED: "true",
        AI_BUDGET_ENFORCED: "true",
        AI_MAX_REQUESTS_PER_WINDOW: "100",
      }),
      /AI_WORKER_TENANT_IDS/
    );
  });

  it("fail-closes production workers without real budget caps", () => {
    assert.throws(
      () => resolveWorkerTenantPolicy({
        APP_ENV: "production",
        AI_WORKERS_ENABLED: "true",
        AI_WORKER_TENANT_IDS: "acme-holding-demo",
        AI_BUDGET_ENFORCED: "true",
        AI_MAX_REQUESTS_PER_WINDOW: "0",
        AI_MAX_TOKENS_PER_WINDOW: "0",
      }),
      /AI_BUDGET_ENFORCED/
    );
  });

  it("allows demo-only allowlist in production", () => {
    const policy = resolveWorkerTenantPolicy({
      APP_ENV: "production",
      AI_WORKERS_ENABLED: "true",
      AI_WORKER_TENANT_IDS: "acme-holding-demo,eval-tenant-should-drop",
      AI_ALLOW_EVAL_TENANTS: "false",
      AI_BUDGET_ENFORCED: "true",
      AI_MAX_REQUESTS_PER_WINDOW: "200",
    });
    assert.deepEqual(policy.tenantIds, ["acme-holding-demo"]);
    assert.equal(policy.isTenantAllowed("acme-holding-demo"), true);
    assert.equal(policy.isTenantAllowed("eval-tenant-x"), false);
    assert.equal(policy.isTenantAllowed("other-tenant"), false);
  });

  it("blocks eval tenants when allowlist is unset in development", () => {
    const policy = resolveWorkerTenantPolicy({
      APP_ENV: "development",
      AI_WORKERS_ENABLED: "true",
    });
    assert.equal(policy.tenantIds, null);
    assert.equal(policy.excludeEval, true);
    assert.equal(policy.isTenantAllowed("acme-holding-demo"), true);
    assert.equal(policy.isTenantAllowed("eval-tenant-x"), false);
  });

  it("filters eligible scopes", () => {
    const policy = resolveWorkerTenantPolicy({
      APP_ENV: "production",
      AI_WORKERS_ENABLED: "true",
      AI_WORKER_TENANT_IDS: "acme-holding-demo",
      AI_BUDGET_ENFORCED: "true",
      AI_MAX_REQUESTS_PER_WINDOW: "50",
    });
    const filtered = filterEligibleScopes([
      { tenantId: "acme-holding-demo", companyId: "c1" },
      { tenantId: "eval-tenant-x", companyId: "c2" },
      { tenantId: "other", companyId: "c3" },
    ], policy);
    assert.deepEqual(filtered.map((s) => s.tenantId), ["acme-holding-demo"]);
  });
});
