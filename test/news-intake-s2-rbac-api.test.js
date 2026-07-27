"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

const { hasPermission, permissionsForRole } = require("../src/auth/rbac");
const { AuthorizationService } = require("../src/auth/authorization");
const { InMemoryMembershipStore } = require("../src/auth/membership.store");
const { createNewsIntakeRouter } = require("../src/routes/news-intake");
const { createIngestRouter } = require("../src/routes/ingest");
const { createRelevanceRouter } = require("../src/routes/relevance");
const { parseIngestTriggerBody } = require("../src/ingest/ingest-trigger");

function mountApp({ role, getIngestRuntime, getStatus, getRecentRuns, logs = [] }) {
  const app = express();
  app.use(express.json());
  const membershipStore = new InMemoryMembershipStore({
    memberships: [{ userId: "actor-s2", tenantId: "tenant-1", companyId: "company-1", role }],
  });
  app.locals.authorizationService = new AuthorizationService({ membershipStore, strictMembership: true });
  app.locals.logger = {
    info(event, fields) { logs.push({ level: "info", event, fields }); },
    warn() {},
    error() {},
  };
  app.use((req, _res, next) => {
    req.authContext = {
      actor: { actorId: "actor-s2", actorType: "human" },
      tenantId: "tenant-1",
      companyId: "company-1",
      scopeTrusted: true,
    };
    next();
  });
  app.use(createNewsIntakeRouter({
    getIngestRuntime,
    getStatus,
    getRecentRuns,
    logger: app.locals.logger,
  }));
  app.use(createIngestRouter({ getIngestRuntime }));
  app.use(createRelevanceRouter({
    getT02Service: () => ({ classify: async () => ({ ok: true }) }),
    getT03Service: () => ({ rationalize: async () => ({ ok: true }) }),
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

test("S2 RBAC: news.intake.* granted narrowly; ai.pipeline.run stays machine/platform only", () => {
  for (const role of ["tenant_owner", "tenant_admin"]) {
    assert.equal(hasPermission(role, "news.intake.read"), true);
    assert.equal(hasPermission(role, "news.intake.trigger"), true);
    assert.equal(hasPermission(role, "news.intake.manage"), true);
    assert.equal(hasPermission(role, "ai.pipeline.run"), false);
  }
  assert.equal(hasPermission("company_admin", "news.intake.read"), true);
  assert.equal(hasPermission("company_admin", "news.intake.trigger"), true);
  assert.equal(hasPermission("company_admin", "news.intake.manage"), false);
  assert.equal(hasPermission("company_admin", "ai.pipeline.run"), false);

  for (const role of ["executive", "analyst", "viewer", "reviewer"]) {
    assert.equal(hasPermission(role, "news.intake.read"), false);
    assert.equal(hasPermission(role, "news.intake.trigger"), false);
    assert.equal(hasPermission(role, "ai.pipeline.run"), false);
  }

  assert.equal(hasPermission("ai_worker", "ai.pipeline.run"), true);
  assert.equal(hasPermission("ai_worker", "news.intake.trigger"), false);
  assert.equal(hasPermission("platform_superadmin", "news.intake.manage"), true);
  assert.equal(hasPermission("platform_superadmin", "ai.pipeline.run"), true);
  assert.equal(permissionsForRole("tenant_owner").has("ai.pipeline.run"), false);
});

test("S2: tenant_owner can pull via news-intake but not raw internal pipeline ingest or T02", async () => {
  const calls = [];
  const logs = [];
  const app = mountApp({
    role: "tenant_owner",
    logs,
    getIngestRuntime: () => ({ queue: queueStub(calls), jobStore: { list: async () => [] } }),
    getStatus: async () => ({
      scheduler: { enabled: false, running: false },
      worker: { running: true },
      workers_enabled: true,
      pipeline: { configured: true },
    }),
  });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await fetch(`${base}/api/v1/news-intake/status`);
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.data.automatic_intake.enabled, false);
    assert.equal(statusBody.data.workers.enabled, true);

    const pull = await fetch(`${base}/api/v1/news-intake/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "news-intake-pull-key01" },
      body: JSON.stringify({ mode: "poll", locale: "id", limit: 10 }),
    });
    assert.equal(pull.status, 202);
    const pullBody = await pull.json();
    assert.equal(pullBody.data.action, "poll");
    assert.equal(pullBody.data.state, "queued");
    assert.equal(calls[0].jobType, "cms.poll");
    assert.equal(calls[0].payload.mode, "poll");
    assert.ok(logs.some((entry) => entry.event === "news_intake_pull_requested"));

    const internal = await fetch(`${base}/api/v1/internal/pipeline/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "news-intake-pull-key02" },
      body: JSON.stringify({ mode: "poll", locale: "id", limit: 10 }),
    });
    assert.equal(internal.status, 403);

    const t02 = await fetch(`${base}/api/v1/internal/relevance/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "news-intake-t02-denied01" },
      body: JSON.stringify({ company_id: "company-1", article_id: "a1" }),
    });
    assert.equal(t02.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("S2: 403 without news.intake.trigger; ai_worker still uses internal ingest with ai.pipeline.run", async () => {
  const calls = [];
  const denied = mountApp({
    role: "viewer",
    getIngestRuntime: () => ({ queue: queueStub(calls), jobStore: { list: async () => [] } }),
  });
  const deniedServer = await listen(denied);
  try {
    const response = await fetch(`http://127.0.0.1:${deniedServer.address().port}/api/v1/news-intake/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "news-intake-denied-key01" },
      body: JSON.stringify({ mode: "poll", locale: "id", limit: 5 }),
    });
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  } finally {
    await new Promise((resolve) => deniedServer.close(resolve));
  }

  const workerCalls = [];
  const workerApp = express();
  workerApp.use(express.json());
  const membershipStore = new InMemoryMembershipStore({
    memberships: [{ userId: "ai-worker-1", tenantId: "tenant-1", companyId: "company-1", role: "ai_worker" }],
  });
  workerApp.locals.authorizationService = new AuthorizationService({ membershipStore, strictMembership: true });
  workerApp.use((req, _res, next) => {
    req.authContext = {
      actor: { actorId: "ai-worker-1", actorType: "ai_worker" },
      tenantId: "tenant-1",
      companyId: "company-1",
      scopeTrusted: true,
    };
    next();
  });
  workerApp.use(createIngestRouter({ getIngestRuntime: () => ({ queue: queueStub(workerCalls) }) }));
  workerApp.use(createNewsIntakeRouter({ getIngestRuntime: () => ({ queue: queueStub(workerCalls), jobStore: { list: async () => [] } }) }));
  const workerServer = await listen(workerApp);
  try {
    const ok = await fetch(`http://127.0.0.1:${workerServer.address().port}/api/v1/internal/pipeline/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "ai-worker-ingest-key01" },
      body: JSON.stringify({ mode: "article", locale: "en", article_id: "cms:article-1" }),
    });
    assert.equal(ok.status, 202);
    assert.equal(workerCalls[0].jobType, "cms.article.trigger");

    const humanSurface = await fetch(`http://127.0.0.1:${workerServer.address().port}/api/v1/news-intake/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "ai-worker-pull-denied01" },
      body: JSON.stringify({ mode: "poll", locale: "id", limit: 5 }),
    });
    assert.equal(humanSurface.status, 403);
  } finally {
    await new Promise((resolve) => workerServer.close(resolve));
  }
});

test("S2: pull validation parity — no content body, locale/limit/crawl bounds, Idempotency-Key", async () => {
  const calls = [];
  const app = mountApp({
    role: "company_admin",
    getIngestRuntime: () => ({ queue: queueStub(calls), jobStore: { list: async () => [] } }),
  });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const withContent = await fetch(`${base}/api/v1/news-intake/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "news-intake-valid-key01" },
      body: JSON.stringify({ mode: "poll", locale: "id", limit: 10, content: "nope" }),
    });
    assert.equal(withContent.status, 400);

    const badLocale = await fetch(`${base}/api/v1/news-intake/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "news-intake-valid-key02" },
      body: JSON.stringify({ mode: "poll", locale: "fr", limit: 10 }),
    });
    assert.equal(badLocale.status, 400);

    const badLimit = await fetch(`${base}/api/v1/news-intake/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "news-intake-valid-key03" },
      body: JSON.stringify({ mode: "poll", locale: "id", limit: 101 }),
    });
    assert.equal(badLimit.status, 400);

    const badCrawl = await fetch(`${base}/api/v1/news-intake/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "news-intake-valid-key04" },
      body: JSON.stringify({ mode: "crawl-poll", locale: "id", limit: 5, crawl_source_id: "not-a-source" }),
    });
    assert.equal(badCrawl.status, 400);

    const missingKey = await fetch(`${base}/api/v1/news-intake/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "poll", locale: "id", limit: 5 }),
    });
    assert.equal(missingKey.status, 400);

    const crawlOk = await fetch(`${base}/api/v1/news-intake/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "news-intake-valid-key05" },
      body: JSON.stringify({ mode: "crawl-poll", locale: "id", limit: 5, crawl_source_id: "detik" }),
    });
    assert.equal(crawlOk.status, 202);
    assert.equal(calls[0].jobType, "crawl.poll");
    assert.equal(calls[0].payload.crawl_source_id, "detik");
    assert.equal(Object.hasOwn(calls[0].payload, "content"), false);

    // Shared parser matches internal ingest rejection rules
    assert.throws(() => parseIngestTriggerBody({ mode: "poll", locale: "id", title: "x" }), /content/);
    assert.throws(() => parseIngestTriggerBody({ mode: "crawl-poll", locale: "id", crawl_source_id: "nope" }), /crawl_source_id/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("S2: trustedScope required; recent runs lists ingest jobs", async () => {
  const app = express();
  app.use(express.json());
  const membershipStore = new InMemoryMembershipStore({
    memberships: [{ userId: "actor-s2", tenantId: "tenant-1", companyId: "company-1", role: "tenant_owner" }],
  });
  app.locals.authorizationService = new AuthorizationService({ membershipStore, strictMembership: true });
  app.use((req, _res, next) => {
    req.authContext = {
      actor: { actorId: "actor-s2", actorType: "human" },
      tenantId: "tenant-1",
      companyId: "company-1",
      scopeTrusted: false,
    };
    next();
  });
  app.use(createNewsIntakeRouter({
    getIngestRuntime: () => ({ queue: queueStub([]), jobStore: { list: async () => [] } }),
  }));
  const untrusted = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${untrusted.address().port}/api/v1/news-intake/status`);
    assert.equal(response.status, 403);
  } finally {
    await new Promise((resolve) => untrusted.close(resolve));
  }

  const runsApp = mountApp({
    role: "tenant_admin",
    getIngestRuntime: () => ({
      queue: queueStub([]),
      jobStore: {
        list: async () => [
          {
            jobId: "j1",
            queueName: "ingest",
            jobType: "cms.poll",
            status: "succeeded",
            payload: { mode: "poll", locale: "id" },
            createdAt: "2026-07-27T02:00:00.000Z",
            updatedAt: "2026-07-27T02:01:00.000Z",
          },
          {
            jobId: "j2",
            queueName: "pipeline-stage",
            jobType: "relevance.classify",
            status: "queued",
            payload: {},
            createdAt: "2026-07-27T03:00:00.000Z",
            updatedAt: "2026-07-27T03:00:00.000Z",
          },
        ],
      },
    }),
  });
  const runsServer = await listen(runsApp);
  try {
    const response = await fetch(`http://127.0.0.1:${runsServer.address().port}/api/v1/news-intake/runs`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.items[0].action, "poll");
    assert.equal(body.data.items[0].id, "j1");
  } finally {
    await new Promise((resolve) => runsServer.close(resolve));
  }
});
