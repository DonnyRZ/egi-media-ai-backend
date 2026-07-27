const test = require("node:test");
const assert = require("node:assert/strict");
const { readSchedulerConfig } = require("../src/automation/scheduler-config");
const { SchedulerStateStore } = require("../src/automation/scheduler-state");
const { PollEnqueueService } = require("../src/automation/poll-enqueue.service");
const { IngestScheduler } = require("../src/automation/scheduler");
const { InMemoryJobStore, JobQueueService } = require("../src/queue");

test("S32 validates safe scheduler defaults and explicit configuration", () => {
  const defaults = readSchedulerConfig({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.workersEnabled, true);
  assert.deepEqual(defaults.locales, ["id"]);
  assert.equal(readSchedulerConfig({ AI_SCHEDULER_ENABLED: "true", AI_SCHEDULER_LOCALES: "id,en", AI_SCHEDULER_INTERVAL_MS: "60000" }).enabled, true);
  assert.throws(() => readSchedulerConfig({ AI_SCHEDULER_LOCALES: "fr" }), /Invalid automation configuration/);
});

test("S33 scheduler state prevents overlapping source/locale work", () => {
  const store = new SchedulerStateStore({ now: () => 1000 });
  const scope = { sourceName: "cms", locale: "id" };
  assert.equal(store.acquire(scope, "a", 1000), true);
  assert.equal(store.acquire(scope, "b", 1000), false);
  store.release(scope, "a");
  assert.equal(store.acquire(scope, "b", 1000), true);
  store.record(scope, { lastEnqueueStatus: "queued" });
  assert.equal(store.get(scope).lastEnqueueStatus, "queued");
});

test("S34 enqueue service is idempotent and does not call CMS", () => {
  const queue = new JobQueueService({ jobStore: new InMemoryJobStore(), now: () => Date.parse("2026-01-01T00:00:00Z") });
  const service = new PollEnqueueService({ queue, now: () => Date.parse("2026-01-01T00:00:00Z") });
  const first = service.enqueuePoll({ tenantId: "system", companyId: "source-ingest", locale: "id", limit: 50 });
  const second = service.enqueuePoll({ tenantId: "system", companyId: "source-ingest", locale: "id", limit: 50 });
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(first.job.payload.mode, "poll");
});

test("S35 scheduler ticks each locale and stops cleanly", async () => {
  let timers = 0; const queued = [];
  const scheduler = new IngestScheduler({ config: { enabled: true, intervalMs: 1000, locales: ["id", "en"], batchSize: 10 }, enqueuePoll: async (input) => { queued.push(input); return { job: { jobId: `job-${queued.length}` } }; }, stateStore: new SchedulerStateStore(), setTimer: () => { timers += 1; return "timer"; }, clearTimer: () => { timers -= 1; } });
  scheduler.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queued.length, 2);
  assert.equal(timers, 1);
  assert.equal(scheduler.status().running, true);
  scheduler.stop();
  assert.equal(timers, 0);
  assert.equal(scheduler.status().running, false);
});
