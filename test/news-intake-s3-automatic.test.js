"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");

const { hasPermission } = require("../src/auth/rbac");
const { AuthorizationService } = require("../src/auth/authorization");
const { InMemoryMembershipStore } = require("../src/auth/membership.store");
const { createNewsIntakeRouter, toNewsIntakeStatus } = require("../src/routes/news-intake");
const { readSchedulerConfig } = require("../src/automation/scheduler-config");
const { resolveAutomationStart } = require("../src/automation/start-policy");
const { SchedulerStateStore } = require("../src/automation/scheduler-state");
const { MultiTenantIngestScheduler } = require("../src/automation/scheduler");
const { QueueWorkerRunner } = require("../src/automation/worker-runner");
const { PollEnqueueService } = require("../src/automation/poll-enqueue.service");
const { InMemoryJobStore, JobQueueService } = require("../src/queue");
const {
  InMemoryAutomaticIntakeSettingsStore,
  FileAutomaticIntakeSettingsStore,
} = require("../src/automation/automatic-intake-settings.store");
const { AutomaticIntakeController } = require("../src/automation/automatic-intake.controller");

function mountApp({
  role,
  getIngestRuntime,
  getStatus,
  setAutomaticIntake,
  getRecentRuns,
  logs = [],
}) {
  const app = express();
  app.use(express.json());
  const membershipStore = new InMemoryMembershipStore({
    memberships: [{ userId: "actor-s3", tenantId: "tenant-1", companyId: "company-1", role }],
  });
  app.locals.authorizationService = new AuthorizationService({ membershipStore, strictMembership: true });
  app.locals.logger = {
    info(event, fields) { logs.push({ level: "info", event, fields }); },
    warn() {},
    error() {},
  };
  app.use((req, _res, next) => {
    req.authContext = {
      actor: { actorId: "actor-s3", actorType: "human" },
      tenantId: "tenant-1",
      companyId: "company-1",
      scopeTrusted: true,
    };
    next();
  });
  app.use(createNewsIntakeRouter({
    getIngestRuntime,
    getStatus,
    setAutomaticIntake,
    getRecentRuns,
    logger: app.locals.logger,
  }));
  return app;
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function queueStub(calls) {
  return {
    enqueue: async (job) => {
      calls.push(job);
      return {
        reused: false,
        job: { jobId: `job-${calls.length}`, status: "queued", updatedAt: "2026-07-27T00:00:00.000Z" },
      };
    },
  };
}

async function buildToggleHarness({ envEnabled = false } = {}) {
  const automation = {
    ...readSchedulerConfig({
      AI_SCHEDULER_ENABLED: envEnabled ? "true" : "false",
      AI_WORKERS_ENABLED: "true",
      AI_SCHEDULER_LOCALES: "id",
      AI_SCHEDULER_INTERVAL_MS: "60000",
      AI_INGEST_BATCH_SIZE: "25",
    }),
  };
  const scheduled = [];
  let schedTimers = 0;
  const settingsStore = new InMemoryAutomaticIntakeSettingsStore();
  let scheduler;
  const controller = new AutomaticIntakeController({
    settingsStore,
    getScheduler: () => scheduler,
    getAutomationConfig: () => automation,
    envDefaultEnabled: Boolean(envEnabled),
    logger: { info() {}, warn() {}, error() {} },
  });
  automation.enabled = await controller.resolveDesiredOnBoot();

  scheduler = new MultiTenantIngestScheduler({
    config: automation,
    listEligible: async () => [{ tenantId: "tenant-1", companyId: "company-1" }],
    enqueuePoll: async (input) => {
      scheduled.push(input);
      return { job: { jobId: `sched-${scheduled.length}` } };
    },
    stateStore: new SchedulerStateStore(),
    setTimer: () => {
      schedTimers += 1;
      return `timer-${schedTimers}`;
    },
    clearTimer: () => {
      schedTimers = Math.max(0, schedTimers - 1);
    },
  });

  const workerRunner = new QueueWorkerRunner({
    queueNames: ["ingest"],
    processNext: async () => null,
    setTimer: () => "worker-timer",
    clearTimer: () => {},
  });

  const { startScheduler, startWorkers } = resolveAutomationStart(automation);
  if (startScheduler) scheduler.start();
  if (startWorkers) workerRunner.start();

  return {
    automation,
    controller,
    scheduler,
    workerRunner,
    scheduled,
    getSchedTimers: () => schedTimers,
    settingsStore,
  };
}

test("S3 RBAC: manage required for automatic toggle; company_admin cannot manage", () => {
  assert.equal(hasPermission("tenant_owner", "news.intake.manage"), true);
  assert.equal(hasPermission("tenant_admin", "news.intake.manage"), true);
  assert.equal(hasPermission("platform_superadmin", "news.intake.manage"), true);
  assert.equal(hasPermission("company_admin", "news.intake.manage"), false);
  assert.equal(hasPermission("company_admin", "news.intake.trigger"), true);
  assert.equal(hasPermission("executive", "news.intake.manage"), false);
  assert.equal(hasPermission("ai_worker", "news.intake.manage"), false);
});

test("S3 status mapping exposes desired/actual_running plus S2 aliases", () => {
  const mapped = toNewsIntakeStatus({
    automatic_intake: {
      desired: true,
      actual_running: true,
      interval_ms: 900000,
      batch_size: 50,
      last_enqueue_at: "2026-07-27T01:00:00.000Z",
      last_enqueue_status: "queued",
      last_error_code: null,
    },
    worker: { running: true },
    workers_enabled: true,
    pipeline: { configured: true },
  });
  assert.equal(mapped.automatic_intake.desired, true);
  assert.equal(mapped.automatic_intake.actual_running, true);
  assert.equal(mapped.automatic_intake.enabled, true);
  assert.equal(mapped.automatic_intake.running, true);
  assert.equal(mapped.automatic_intake.interval_ms, 900000);
  assert.equal(mapped.automatic_intake.batch_size, 50);
  assert.equal(mapped.workers.running, true);
});

test("S3: manage without permission → 403; tenant_owner can toggle", async () => {
  const harness = await buildToggleHarness({ envEnabled: false });
  const getStatus = async () => ({
    automatic_intake: await harness.controller.getStatus(),
    worker: harness.workerRunner.status(),
    workers_enabled: true,
    pipeline: { configured: true },
  });
  const setAutomaticIntake = async ({ desired, actorId, role }) => harness.controller.setDesired(desired, { actorId, role });

  const denied = mountApp({
    role: "company_admin",
    getStatus,
    setAutomaticIntake,
    getIngestRuntime: () => ({ queue: queueStub([]), jobStore: { list: async () => [] } }),
  });
  const deniedServer = await listen(denied);
  try {
    const response = await fetch(`http://127.0.0.1:${deniedServer.address().port}/api/v1/news-intake/automatic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desired: true }),
    });
    assert.equal(response.status, 403);
  } finally {
    await new Promise((resolve) => deniedServer.close(resolve));
    harness.scheduler.stop();
    harness.workerRunner.stop();
  }

  const harness2 = await buildToggleHarness({ envEnabled: false });
  const ownerApp = mountApp({
    role: "tenant_owner",
    getStatus: async () => ({
      automatic_intake: await harness2.controller.getStatus(),
      worker: harness2.workerRunner.status(),
      workers_enabled: true,
      pipeline: { configured: true },
    }),
    setAutomaticIntake: async ({ desired, actorId, role }) => harness2.controller.setDesired(desired, { actorId, role }),
    getIngestRuntime: () => ({ queue: queueStub([]), jobStore: { list: async () => [] } }),
  });
  const ownerServer = await listen(ownerApp);
  try {
    const enable = await fetch(`http://127.0.0.1:${ownerServer.address().port}/api/v1/news-intake/automatic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desired: true }),
    });
    assert.equal(enable.status, 200);
    const body = await enable.json();
    assert.equal(body.data.automatic_intake.desired, true);
    assert.equal(body.data.automatic_intake.actual_running, true);
    assert.equal(body.data.automatic_intake.enabled, true);
    assert.equal(body.data.workers.running, true);
  } finally {
    await new Promise((resolve) => ownerServer.close(resolve));
    harness2.scheduler.stop();
    harness2.workerRunner.stop();
  }
});

test("S3: enable/disable flips scheduler only; workers stay up; pull still works when automatic off", async () => {
  const harness = await buildToggleHarness({ envEnabled: false });
  assert.equal(harness.scheduler.status().running, false);
  assert.equal(harness.workerRunner.status().running, true);

  await harness.controller.setDesired(true);
  assert.equal(harness.scheduler.status().running, true);
  assert.equal(harness.workerRunner.status().running, true);
  assert.ok(harness.getSchedTimers() >= 1);

  // Idempotent enable
  await harness.controller.setDesired(true);
  assert.equal(harness.scheduler.status().running, true);

  await harness.controller.setDesired(false);
  assert.equal(harness.scheduler.status().running, false);
  assert.equal(harness.workerRunner.status().running, true);
  assert.equal((await harness.controller.getStatus()).desired, false);
  assert.equal((await harness.controller.getStatus()).actual_running, false);

  // Manual pull path still enqueues while automatic off
  const calls = [];
  const app = mountApp({
    role: "tenant_owner",
    getIngestRuntime: () => ({ queue: queueStub(calls), jobStore: { list: async () => [] } }),
    getStatus: async () => ({
      automatic_intake: await harness.controller.getStatus(),
      worker: harness.workerRunner.status(),
      workers_enabled: true,
      pipeline: { configured: true },
    }),
    setAutomaticIntake: async ({ desired }) => harness.controller.setDesired(desired),
  });
  const server = await listen(app);
  try {
    const pull = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-intake/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "s3-pull-while-off-001" },
      body: JSON.stringify({ mode: "poll", locale: "id", limit: 5 }),
    });
    assert.equal(pull.status, 202);
    assert.equal(calls[0].jobType, "cms.poll");
    assert.equal(calls[0].payload.mode, "poll");
    assert.equal(harness.scheduler.status().running, false);
    assert.equal(harness.workerRunner.status().running, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    harness.scheduler.stop();
    harness.workerRunner.stop();
  }
});

test("S3: off stops scheduled ticks; on restores; never enqueues crawl", async () => {
  const harness = await buildToggleHarness({ envEnabled: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.scheduled.length, 1);
  assert.equal(harness.scheduled[0].trigger, "scheduled");

  await harness.controller.setDesired(false);
  const before = harness.scheduled.length;
  harness.scheduler.running = false;
  await harness.scheduler.tick();
  assert.equal(harness.scheduled.length, before);

  await harness.controller.setDesired(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(harness.scheduled.length > before);
  for (const item of harness.scheduled) {
    assert.equal(Object.hasOwn(item, "crawl_source_id"), false);
  }

  harness.scheduler.stop();
  harness.workerRunner.stop();
});

test("S3 restart: persisted desired wins over env; env seeds only when empty", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "egi-auto-intake-"));
  const filePath = path.join(dir, "settings.json");
  try {
    const storeA = new FileAutomaticIntakeSettingsStore({ filePath });
    const automationA = { ...readSchedulerConfig({ AI_SCHEDULER_ENABLED: "false", AI_WORKERS_ENABLED: "true" }) };
    let schedulerA;
    const controllerA = new AutomaticIntakeController({
      settingsStore: storeA,
      getScheduler: () => schedulerA,
      getAutomationConfig: () => automationA,
      envDefaultEnabled: false,
    });
    assert.equal(await controllerA.resolveDesiredOnBoot(), false);
    schedulerA = new MultiTenantIngestScheduler({
      config: automationA,
      listEligible: async () => [],
      enqueuePoll: async () => ({ job: { jobId: "x" } }),
      stateStore: new SchedulerStateStore(),
      setTimer: () => "t",
      clearTimer: () => {},
    });
    await controllerA.setDesired(true);
    assert.equal((await storeA.get()).desired, true);

    // Simulated restart: env still false, but persisted desired true
    const storeB = new FileAutomaticIntakeSettingsStore({ filePath });
    const automationB = { ...readSchedulerConfig({ AI_SCHEDULER_ENABLED: "false", AI_WORKERS_ENABLED: "true" }) };
    const controllerB = new AutomaticIntakeController({
      settingsStore: storeB,
      getScheduler: () => null,
      getAutomationConfig: () => automationB,
      envDefaultEnabled: false,
    });
    assert.equal(await controllerB.resolveDesiredOnBoot(), true);
    assert.equal((await storeB.get()).source, "manage_api");

    // Fresh store seeds from env only once
    const mem = new InMemoryAutomaticIntakeSettingsStore();
    const seeded = new AutomaticIntakeController({
      settingsStore: mem,
      getScheduler: () => null,
      getAutomationConfig: () => ({ enabled: true, intervalMs: 1, batchSize: 1, locales: ["id"] }),
      envDefaultEnabled: true,
    });
    assert.equal(await seeded.resolveDesiredOnBoot(), true);
    assert.equal((await mem.get()).source, "env_default");
    // Second boot keeps persisted desired even if envDefault flips
    const seeded2 = new AutomaticIntakeController({
      settingsStore: mem,
      getScheduler: () => null,
      getAutomationConfig: () => ({ enabled: false, intervalMs: 1, batchSize: 1, locales: ["id"] }),
      envDefaultEnabled: false,
    });
    assert.equal(await seeded2.resolveDesiredOnBoot(), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("S3 status includes interval_ms/batch_size and last enqueue fields after tick", async () => {
  const automation = {
    ...readSchedulerConfig({
      AI_SCHEDULER_ENABLED: "true",
      AI_SCHEDULER_LOCALES: "id",
      AI_SCHEDULER_INTERVAL_MS: "120000",
      AI_INGEST_BATCH_SIZE: "17",
    }),
  };
  const settingsStore = new InMemoryAutomaticIntakeSettingsStore({
    initial: { desired: true, updatedAt: "2026-07-27T00:00:00.000Z", source: "env_default" },
  });
  let scheduler;
  const controller = new AutomaticIntakeController({
    settingsStore,
    getScheduler: () => scheduler,
    getAutomationConfig: () => automation,
    envDefaultEnabled: true,
  });
  scheduler = new MultiTenantIngestScheduler({
    config: automation,
    listEligible: async () => [{ tenantId: "t", companyId: "c" }],
    enqueuePoll: async () => ({ job: { jobId: "job-last-1" } }),
    stateStore: new SchedulerStateStore(),
    setTimer: () => "t",
    clearTimer: () => {},
  });
  scheduler.running = true;
  await scheduler.tick();
  const status = await controller.getStatus();
  assert.equal(status.desired, true);
  assert.equal(status.interval_ms, 120000);
  assert.equal(status.batch_size, 17);
  assert.equal(status.last_enqueue_status, "queued");
  assert.equal(status.last_job_id, "job-last-1");
  assert.ok(status.last_enqueue_at);
});

test("S3: workers still process manual ingest when automatic desired off (S1 regression shape)", async () => {
  const automation = readSchedulerConfig({
    AI_SCHEDULER_ENABLED: "false",
    AI_WORKERS_ENABLED: "true",
    AI_SCHEDULER_LOCALES: "id",
  });
  const settingsStore = new InMemoryAutomaticIntakeSettingsStore({
    initial: { desired: false, updatedAt: "2026-07-27T00:00:00.000Z", source: "manage_api" },
  });
  let scheduler;
  const controller = new AutomaticIntakeController({
    settingsStore,
    getScheduler: () => scheduler,
    getAutomationConfig: () => automation,
    envDefaultEnabled: false,
  });
  automation.enabled = await controller.resolveDesiredOnBoot();
  assert.equal(automation.enabled, false);

  scheduler = new MultiTenantIngestScheduler({
    config: automation,
    listEligible: async () => [{ tenantId: "tenant-a", companyId: "company-a" }],
    enqueuePoll: async () => ({ job: { jobId: "should-not-run" } }),
    stateStore: new SchedulerStateStore(),
    setTimer: () => "t",
    clearTimer: () => {},
  });
  const { startScheduler, startWorkers } = resolveAutomationStart(automation);
  assert.equal(startScheduler, false);
  assert.equal(startWorkers, true);
  assert.equal(scheduler.start(), false);

  const jobStore = new InMemoryJobStore();
  const queue = new JobQueueService({ jobStore, workerId: "ingest-worker", now: () => Date.parse("2026-07-27T00:00:00Z") });
  const pollEnqueue = new PollEnqueueService({ queue, maxAttempts: 3, now: () => Date.parse("2026-07-27T00:00:00Z") });
  await pollEnqueue.enqueuePoll({
    tenantId: "tenant-a",
    companyId: "company-a",
    locale: "id",
    limit: 10,
    trigger: "manual",
    scheduleKey: "manual",
  });

  let processed = 0;
  const workerRunner = new QueueWorkerRunner({
    queueNames: ["ingest"],
    concurrency: 1,
    intervalMs: 60_000,
    processNext: (queueName) => queue.processNext({
      queueName,
      handler: async () => {
        processed += 1;
        return { ok: true };
      },
    }),
    setTimer: () => "worker-timer",
    clearTimer: () => {},
  });
  assert.equal(workerRunner.start(), true);
  await workerRunner.pump();
  assert.equal(processed, 1);
  workerRunner.stop();
});
