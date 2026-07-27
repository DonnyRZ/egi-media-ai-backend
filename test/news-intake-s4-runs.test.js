"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

const { hasPermission } = require("../src/auth/rbac");
const { AuthorizationService } = require("../src/auth/authorization");
const { InMemoryMembershipStore } = require("../src/auth/membership.store");
const { InMemoryJobStore } = require("../src/queue");
const {
  createNewsIntakeRouter,
  parseRunsQuery,
  listRecentRunsFromStore,
  encodeRunsCursor,
  mapRecentRuns,
} = require("../src/routes/news-intake");

function mountApp({
  role = "tenant_admin",
  tenantId = "tenant-1",
  companyId = "company-1",
  getIngestRuntime,
  getRecentRuns,
} = {}) {
  const app = express();
  app.use(express.json());
  const membershipStore = new InMemoryMembershipStore({
    memberships: [{ userId: "actor-s4", tenantId, companyId, role }],
  });
  app.locals.authorizationService = new AuthorizationService({ membershipStore, strictMembership: true });
  app.use((req, _res, next) => {
    req.authContext = {
      actor: { actorId: "actor-s4", actorType: "human" },
      tenantId,
      companyId,
      scopeTrusted: true,
      role,
    };
    next();
  });
  app.use(createNewsIntakeRouter({ getIngestRuntime, getRecentRuns }));
  return app;
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function seedJobs(store, rows) {
  let t = Date.parse("2026-07-27T10:00:00.000Z");
  for (const row of rows) {
    const created = row.createdAt || new Date(t).toISOString();
    t += 60_000;
    const result = store.createOrGet({
      tenantId: row.tenantId,
      companyId: row.companyId,
      queueName: row.queueName || "ingest",
      jobType: row.jobType,
      idempotencyKey: row.idempotencyKey || `key-${row.jobType}-${created}-${row.companyId}`,
      payload: row.payload || { mode: "poll", locale: "id" },
      maxAttempts: 3,
      availableAt: Date.parse(created),
    });
    const job = store.jobsById.get(result.job.jobId);
    job.createdAt = created;
    job.updatedAt = row.updatedAt || created;
    if (row.status && row.status !== "queued") job.status = row.status;
    if (row.jobId) {
      store.jobsById.delete(result.job.jobId);
      store.jobIdByKey.set(
        `${row.tenantId}|${row.companyId}|${row.queueName || "ingest"}|${row.idempotencyKey || `key-${row.jobType}-${created}-${row.companyId}`}`,
        row.jobId,
      );
      job.jobId = row.jobId;
      store.jobsById.set(row.jobId, job);
    }
  }
  return store;
}

test("S4 query validation: bad limit/offset/status/cursor rejected", () => {
  assert.throws(() => parseRunsQuery({ limit: "0" }), /limit must be/);
  assert.throws(() => parseRunsQuery({ limit: "101" }), /limit must be/);
  assert.throws(() => parseRunsQuery({ limit: "abc" }), /limit must be/);
  assert.throws(() => parseRunsQuery({ offset: "-1" }), /offset must be/);
  assert.throws(() => parseRunsQuery({ offset: "1.5" }), /offset must be/);
  assert.throws(() => parseRunsQuery({ status: "done" }), /status must be one of/);
  assert.throws(() => parseRunsQuery({ cursor: "!!!not-base64!!!" }), /cursor is invalid/);
  assert.throws(() => parseRunsQuery({ offset: "1", cursor: encodeRunsCursor(2) }), /cursor or offset/);
  assert.throws(() => parseRunsQuery({ include_ai_tasks: "maybe" }), /include_ai_tasks/);

  const ok = parseRunsQuery({ limit: "20", status: "succeeded" });
  assert.equal(ok.limit, 20);
  assert.equal(ok.offset, 0);
  assert.equal(ok.status, "succeeded");
  assert.equal(ok.includeAiTasks, false);

  const viaCursor = parseRunsQuery({ cursor: encodeRunsCursor(40) });
  assert.equal(viaCursor.offset, 40);
});

test("S4: news.intake.read required for Recent runs", async () => {
  assert.equal(hasPermission("viewer", "news.intake.read"), false);
  assert.equal(hasPermission("tenant_admin", "news.intake.read"), true);

  const store = new InMemoryJobStore();
  const app = express();
  app.use(express.json());
  const membershipStore = new InMemoryMembershipStore({
    memberships: [{ userId: "viewer-1", tenantId: "tenant-1", companyId: "company-1", role: "viewer" }],
  });
  app.locals.authorizationService = new AuthorizationService({ membershipStore, strictMembership: true });
  app.use((req, _res, next) => {
    req.authContext = {
      actor: { actorId: "viewer-1", actorType: "human" },
      tenantId: "tenant-1",
      companyId: "company-1",
      scopeTrusted: true,
    };
    next();
  });
  app.use(createNewsIntakeRouter({
    getIngestRuntime: () => ({ jobStore: store, queue: { enqueue: async () => ({}) } }),
  }));
  const server = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-intake/runs`);
    assert.equal(response.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("S4: pagination newest-first, bounded, cursor/offset, ingest-family filter", async () => {
  const store = new InMemoryJobStore();
  seedJobs(store, [
    {
      jobId: "old-poll",
      tenantId: "tenant-1",
      companyId: "company-1",
      jobType: "cms.poll",
      payload: { mode: "poll", locale: "id" },
      status: "succeeded",
      createdAt: "2026-07-27T01:00:00.000Z",
    },
    {
      jobId: "mid-crawl",
      tenantId: "tenant-1",
      companyId: "company-1",
      jobType: "crawl.poll",
      payload: { mode: "crawl-poll", locale: "id", crawl_source_id: "detik" },
      status: "queued",
      createdAt: "2026-07-27T02:00:00.000Z",
    },
    {
      jobId: "new-article",
      tenantId: "tenant-1",
      companyId: "company-1",
      jobType: "cms.article.trigger",
      payload: { mode: "article", locale: "en", article_id: "cms:abc" },
      status: "running",
      createdAt: "2026-07-27T03:00:00.000Z",
    },
    {
      jobId: "ai-noise",
      tenantId: "tenant-1",
      companyId: "company-1",
      queueName: "pipeline-stage",
      jobType: "relevance.classify",
      payload: {},
      status: "queued",
      createdAt: "2026-07-27T04:00:00.000Z",
    },
  ]);

  const app = mountApp({
    getIngestRuntime: () => ({ jobStore: store, queue: { enqueue: async () => ({}) } }),
  });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page1 = await fetch(`${base}/api/v1/news-intake/runs?limit=2`);
    assert.equal(page1.status, 200);
    const body1 = await page1.json();
    assert.equal(body1.data.items.length, 2);
    assert.equal(body1.data.limit, 2);
    assert.equal(body1.data.offset, 0);
    assert.equal(body1.data.has_more, true);
    assert.equal(body1.data.next_offset, 2);
    assert.ok(body1.data.next_cursor);
    assert.equal(body1.data.items[0].id, "new-article");
    assert.equal(body1.data.items[1].id, "mid-crawl");
    assert.equal(body1.data.items[0].when, "2026-07-27T03:00:00.000Z");
    assert.equal(body1.data.items[0].source, "egi-media-cms");
    assert.equal(body1.data.items[0].mode, "article");
    assert.equal(body1.data.items[0].state, "running");
    assert.equal(body1.data.items[0].family, "intake");
    assert.equal(body1.data.items[1].source, "detik");
    assert.equal(body1.data.items[1].mode, "crawl-poll");
    assert.ok(!body1.data.items.some((item) => item.id === "ai-noise"));

    const page2 = await fetch(`${base}/api/v1/news-intake/runs?limit=2&cursor=${encodeURIComponent(body1.data.next_cursor)}`);
    assert.equal(page2.status, 200);
    const body2 = await page2.json();
    assert.equal(body2.data.items.length, 1);
    assert.equal(body2.data.items[0].id, "old-poll");
    assert.equal(body2.data.has_more, false);
    assert.equal(body2.data.next_offset, null);
    assert.equal(body2.data.next_cursor, null);

    const byOffset = await fetch(`${base}/api/v1/news-intake/runs?limit=1&offset=1`);
    const offsetBody = await byOffset.json();
    assert.equal(offsetBody.data.items[0].id, "mid-crawl");

    const byStatus = await fetch(`${base}/api/v1/news-intake/runs?status=succeeded`);
    const statusBody = await byStatus.json();
    assert.equal(statusBody.data.items.length, 1);
    assert.equal(statusBody.data.items[0].id, "old-poll");

    const withAi = await fetch(`${base}/api/v1/news-intake/runs?include_ai_tasks=true&limit=10`);
    const aiBody = await withAi.json();
    assert.ok(aiBody.data.items.some((item) => item.id === "ai-noise" && item.family === "ai_task"));

    const bad = await fetch(`${base}/api/v1/news-intake/runs?limit=999`);
    assert.equal(bad.status, 400);
    const badBody = await bad.json();
    assert.equal(badBody.error?.code || badBody.code, "VALIDATION_ERROR");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("S4: company scope isolation — no cross-company job leakage", async () => {
  const store = new InMemoryJobStore();
  seedJobs(store, [
    {
      jobId: "ours",
      tenantId: "tenant-1",
      companyId: "company-1",
      jobType: "cms.poll",
      payload: { mode: "poll", locale: "id" },
      createdAt: "2026-07-27T05:00:00.000Z",
    },
    {
      jobId: "theirs",
      tenantId: "tenant-1",
      companyId: "company-2",
      jobType: "cms.poll",
      payload: { mode: "poll", locale: "id" },
      createdAt: "2026-07-27T06:00:00.000Z",
    },
    {
      jobId: "other-tenant",
      tenantId: "tenant-9",
      companyId: "company-9",
      jobType: "cms.poll",
      payload: { mode: "poll", locale: "id" },
      createdAt: "2026-07-27T07:00:00.000Z",
    },
  ]);

  const page = await listRecentRunsFromStore(store, {
    tenantId: "tenant-1",
    companyId: "company-1",
    limit: 50,
    offset: 0,
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, "ours");

  const app = mountApp({
    companyId: "company-1",
    getIngestRuntime: () => ({ jobStore: store, queue: { enqueue: async () => ({}) } }),
  });
  const server = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-intake/runs?limit=100`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.items[0].id, "ours");
    assert.ok(!body.data.items.some((item) => item.id === "theirs" || item.id === "other-tenant"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("S4: mapRecentRuns stays ingest-only and newest-first (S2 compat)", () => {
  const items = mapRecentRuns([
    {
      jobId: "j2",
      queueName: "ingest",
      jobType: "cms.poll",
      status: "queued",
      payload: { mode: "poll", locale: "id" },
      createdAt: "2026-07-27T02:00:00.000Z",
      updatedAt: "2026-07-27T02:00:00.000Z",
    },
    {
      jobId: "j1",
      queueName: "ingest",
      jobType: "cms.poll",
      status: "succeeded",
      payload: { mode: "poll", locale: "id" },
      createdAt: "2026-07-27T01:00:00.000Z",
      updatedAt: "2026-07-27T01:00:00.000Z",
    },
    {
      jobId: "noise",
      queueName: "pipeline-stage",
      jobType: "relevance.classify",
      status: "queued",
      payload: {},
      createdAt: "2026-07-27T03:00:00.000Z",
      updatedAt: "2026-07-27T03:00:00.000Z",
    },
  ], 20);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "j2");
  assert.equal(items[0].action, "poll");
  assert.equal(items[0].family, "intake");
});

test("S4: listRecentRunsFromStore refuses missing company scope", async () => {
  const store = new InMemoryJobStore();
  await assert.rejects(
    () => listRecentRunsFromStore(store, { tenantId: "t", companyId: null, limit: 10 }),
    /Tenant and company/,
  );
});
