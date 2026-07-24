const test = require("node:test");
const assert = require("node:assert/strict");
const { AiBudgetGate } = require("../src/automation/ai-budget");
const { InMemoryJobStore } = require("../src/queue");

test("S41 AI budget gate fails closed at request and token limits", () => {
  let now = 0; const gate = new AiBudgetGate({ maxRequests: 1, maxTokens: 10, windowMs: 1000, enforced: true, now: () => now });
  gate.beforeRequest(); gate.recordUsage({ totalTokens: 10 });
  assert.throws(() => gate.beforeRequest(), { code: "AI_BUDGET_EXCEEDED" });
  now = 1001; gate.beforeRequest();
  assert.throws(() => gate.recordUsage({ totalTokens: 11 }), { code: "AI_BUDGET_EXCEEDED" });
});

test("S41 budget windows are isolated per tenant/company scope", () => {
  const gate = new AiBudgetGate({ maxRequests: 1, enforced: true, now: () => 0 });
  gate.beforeRequest({ tenantId: "tenant-a", companyId: "shared-company-id" });
  assert.throws(() => gate.beforeRequest({ tenantId: "tenant-a", companyId: "shared-company-id" }), { code: "AI_BUDGET_EXCEEDED" });
  assert.doesNotThrow(() => gate.beforeRequest({ tenantId: "tenant-b", companyId: "shared-company-id" }));
  assert.equal(gate.snapshot({ tenantId: "tenant-a", companyId: "shared-company-id" }).requests, 1);
  assert.equal(gate.snapshot({ tenantId: "tenant-b", companyId: "shared-company-id" }).requests, 1);
});

test("S42 stale running jobs are recovered without changing completed jobs", () => {
  let now = 100000; const store = new InMemoryJobStore({ now: () => now, uuid: () => "job-1" });
  const created = store.createOrGet({ tenantId: "t", companyId: "c", queueName: "ingest", jobType: "cms.poll", idempotencyKey: "stale-job-key-1234", payload: {}, maxAttempts: 3 });
  store.claimNext({ queueName: "ingest", workerId: "worker", now });
  now += 600001;
  assert.equal(store.recoverStale({ olderThanMs: 600000, now }), 1);
  assert.equal(store.get({ tenantId: "t", companyId: "c", jobId: created.job.jobId }).status, "retrying");
});
