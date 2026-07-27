const test = require("node:test");
const assert = require("node:assert/strict");
const { readSchedulerConfig } = require("../src/automation/scheduler-config");
const { resolveAutomationStart } = require("../src/automation/start-policy");
const { SchedulerStateStore } = require("../src/automation/scheduler-state");
const { IngestScheduler } = require("../src/automation/scheduler");
const { QueueWorkerRunner } = require("../src/automation/worker-runner");
const { InMemoryJobStore, JobQueueService } = require("../src/queue");
const { PollEnqueueService } = require("../src/automation/poll-enqueue.service");

test("S1 config: workers default on while scheduler defaults off", () => {
  const defaults = readSchedulerConfig({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.workersEnabled, true);
  assert.equal(readSchedulerConfig({ AI_WORKERS_ENABLED: "false" }).workersEnabled, false);
  assert.equal(readSchedulerConfig({ AI_SCHEDULER_ENABLED: "true", AI_WORKERS_ENABLED: "true" }).enabled, true);
});

test("S1 start policy: scheduler off does not disable workers", () => {
  assert.deepEqual(resolveAutomationStart({ enabled: false, workersEnabled: true }), {
    startScheduler: false,
    startWorkers: true,
  });
  assert.deepEqual(resolveAutomationStart({ enabled: true, workersEnabled: true }), {
    startScheduler: true,
    startWorkers: true,
  });
  assert.deepEqual(resolveAutomationStart({ enabled: true, workersEnabled: false }), {
    startScheduler: true,
    startWorkers: false,
  });
  // Missing flag must stay fail-open for workers (manual intake)
  assert.deepEqual(resolveAutomationStart({ enabled: false }), {
    startScheduler: false,
    startWorkers: true,
  });
});

test("S1: scheduler disabled does not enqueue CMS polls; workers still process ingest jobs", async () => {
  const automation = readSchedulerConfig({
    AI_SCHEDULER_ENABLED: "false",
    AI_WORKERS_ENABLED: "true",
    AI_SCHEDULER_LOCALES: "id",
  });
  const { startScheduler, startWorkers } = resolveAutomationStart(automation);
  assert.equal(startScheduler, false);
  assert.equal(startWorkers, true);

  const scheduled = [];
  let timers = 0;
  const scheduler = new IngestScheduler({
    config: automation,
    enqueuePoll: async (input) => {
      scheduled.push(input);
      return { job: { jobId: `sched-${scheduled.length}` } };
    },
    stateStore: new SchedulerStateStore(),
    setTimer: () => {
      timers += 1;
      return "sched-timer";
    },
    clearTimer: () => {
      timers -= 1;
    },
  });
  assert.equal(scheduler.start(), false);
  assert.equal(scheduler.status().running, false);
  assert.equal(timers, 0);
  assert.equal(scheduled.length, 0);

  const jobStore = new InMemoryJobStore();
  const queue = new JobQueueService({ jobStore, workerId: "ingest-worker", now: () => Date.parse("2026-07-27T00:00:00Z") });
  const pollEnqueue = new PollEnqueueService({ queue, maxAttempts: 3, now: () => Date.parse("2026-07-27T00:00:00Z") });
  // Manual Pull articles now path (same queue as API enqueue)
  const enqueued = await pollEnqueue.enqueuePoll({
    tenantId: "tenant-a",
    companyId: "company-a",
    locale: "id",
    limit: 10,
    trigger: "manual",
    scheduleKey: "manual",
  });
  assert.equal(enqueued.job.status, "queued");
  assert.equal(enqueued.job.payload.mode, "poll");
  assert.equal(enqueued.job.payload.trigger, "manual");

  let processedModes = [];
  const workerRunner = new QueueWorkerRunner({
    queueNames: ["ingest"],
    concurrency: 1,
    intervalMs: 60_000,
    processNext: (queueName) => queue.processNext({
      queueName,
      handler: async (job) => {
        processedModes.push(job.payload.mode);
        return { ok: true, mode: job.payload.mode };
      },
    }),
    setTimer: () => "worker-timer",
    clearTimer: () => {},
  });

  assert.equal(workerRunner.start(), true);
  assert.equal(workerRunner.status().running, true);
  await workerRunner.pump();
  assert.deepEqual(processedModes, ["poll"]);
  const listed = await jobStore.list({ tenantId: "tenant-a", companyId: "company-a" });
  assert.equal(listed[0]?.status, "succeeded");
  workerRunner.stop();
});

test("S1: both enabled preserves scheduler ticks and worker processing", async () => {
  const automation = readSchedulerConfig({
    AI_SCHEDULER_ENABLED: "true",
    AI_WORKERS_ENABLED: "true",
    AI_SCHEDULER_INTERVAL_MS: "60000",
    AI_SCHEDULER_LOCALES: "id",
  });
  const { startScheduler, startWorkers } = resolveAutomationStart(automation);
  assert.equal(startScheduler, true);
  assert.equal(startWorkers, true);

  const scheduled = [];
  let schedTimers = 0;
  const scheduler = new IngestScheduler({
    config: automation,
    enqueuePoll: async (input) => {
      scheduled.push(input);
      return { job: { jobId: `sched-${scheduled.length}` } };
    },
    stateStore: new SchedulerStateStore(),
    setTimer: () => {
      schedTimers += 1;
      return "sched-timer";
    },
    clearTimer: () => {
      schedTimers -= 1;
    },
  });
  assert.equal(scheduler.start(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].trigger, "scheduled");
  assert.equal(schedTimers, 1);
  scheduler.stop();

  let workerRunning = false;
  const workerRunner = new QueueWorkerRunner({
    queueNames: ["ingest"],
    processNext: async () => null,
    setTimer: () => "worker-timer",
    clearTimer: () => {},
  });
  if (startWorkers) workerRunner.start();
  workerRunning = workerRunner.status().running;
  assert.equal(workerRunning, true);
  workerRunner.stop();
});

test("S1: workers disabled leaves queued ingest unprocessed (explicit pause)", async () => {
  const automation = readSchedulerConfig({ AI_SCHEDULER_ENABLED: "false", AI_WORKERS_ENABLED: "false" });
  const { startScheduler, startWorkers } = resolveAutomationStart(automation);
  assert.equal(startScheduler, false);
  assert.equal(startWorkers, false);

  const jobStore = new InMemoryJobStore();
  const queue = new JobQueueService({ jobStore, workerId: "ingest-worker" });
  await queue.enqueue({
    tenantId: "t",
    companyId: "c",
    queueName: "ingest",
    jobType: "cms.poll",
    idempotencyKey: "manual-pause-key-001",
    payload: { mode: "poll", locale: "id", limit: 5 },
    maxAttempts: 3,
  });

  // Mirror server policy: do not start workerRunner when workersEnabled=false
  assert.equal(startWorkers, false);
  const listed = await jobStore.list({ tenantId: "t", companyId: "c" });
  assert.equal(listed[0].status, "queued");
});

test("S1: scheduler path never enqueues crawl-poll (no accidental crawl schedule)", async () => {
  const automation = readSchedulerConfig({ AI_SCHEDULER_ENABLED: "true", AI_SCHEDULER_LOCALES: "id,en" });
  const jobStore = new InMemoryJobStore();
  const queue = new JobQueueService({ jobStore, now: () => Date.parse("2026-07-27T01:00:00Z") });
  const service = new PollEnqueueService({ queue, now: () => Date.parse("2026-07-27T01:00:00Z") });
  const scheduler = new IngestScheduler({
    config: automation,
    tenantId: "system",
    companyId: "source-ingest",
    enqueuePoll: (input) => service.enqueuePoll(input),
    stateStore: new SchedulerStateStore(),
    setTimer: () => "t",
    clearTimer: () => {},
  });
  scheduler.running = true;
  await scheduler.tick();
  const jobs = jobStore.list();
  assert.equal(jobs.length, 2);
  for (const job of jobs) {
    assert.equal(job.jobType, "cms.poll");
    assert.equal(job.payload.mode, "poll");
    assert.equal(job.payload.trigger, "scheduled");
    assert.equal(job.payload.source_name, "egi-media-cms");
    assert.equal(Object.hasOwn(job.payload, "crawl_source_id"), false);
  }
});
