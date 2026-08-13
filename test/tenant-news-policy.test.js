"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

require("./support/test-env");

const {
  getAllowedChannelIds,
  listEntitledChannels,
  mergeAllowedNewsChannels,
  parseAllowedChannelIds,
  visibleChannelIds,
} = require("../src/auth/tenant-news-policy");
const { createNewsFeedService } = require("../src/news-feed/news-feed.service");
const { createNewsFeedRouter } = require("../src/routes/news-feed");
const { enqueueIngestTrigger } = require("../src/ingest/ingest-trigger");
const { CrawlIngestService } = require("../src/source/crawl-ingest.service");
const Server = require("../src/app/server");

const VISIBLE_IDS = visibleChannelIds();

function json(value) {
  return JSON.stringify(value);
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

function emptyFeedService() {
  return createNewsFeedService({
    crawlArticleReader: { listArticles: async () => ({ items: [], next_cursor: null }) },
    cmsArticleClient: { listPublishedArticles: async () => ({ items: [], nextCursor: null }) },
    portalBaseUrl: "http://portal.example",
  });
}

function listenNewsFeed({ tenant = null } = {}) {
  const app = express();
  app.use((req, _res, next) => {
    req.authContext = {
      actor: { actorId: "actor-1" },
      tenantId: "tenant-1",
      companyId: "company-1",
      scopeTrusted: true,
    };
    next();
  });
  app.use(createNewsFeedRouter({
    getNewsFeedService: () => emptyFeedService(),
    getTenantStore: tenant === undefined
      ? undefined
      : () => ({ get: async () => tenant }),
  }));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("parseAllowedChannelIds rejects viral, unknown, and empty selections", () => {
  assert.throws(() => parseAllowedChannelIds([]), /at least one/);
  assert.throws(() => parseAllowedChannelIds(["viral"]), /Unknown or unavailable/);
  assert.throws(() => parseAllowedChannelIds(["kompas"]), /Unknown or unavailable/);
  assert.deepEqual(parseAllowedChannelIds(["egi_media", "detik", "egi_media"]), ["egi_media", "detik"]);
});

test("missing or null allowlist key entitles every visible channel", () => {
  assert.deepEqual(getAllowedChannelIds(null), VISIBLE_IDS);
  assert.deepEqual(getAllowedChannelIds({ metadata: {} }), VISIBLE_IDS);
  assert.deepEqual(getAllowedChannelIds({ metadata: { allowed_news_channel_ids: null } }), VISIBLE_IDS);
  assert.equal(getAllowedChannelIds({ metadata: {} }).includes("viral"), false);
  assert.deepEqual(
    listEntitledChannels({ metadata: { allowed_news_channel_ids: ["detik", "egi_media"] } }).map((item) => item.id),
    ["egi_media", "detik"],
  );
});

test("mergeAllowedNewsChannels preserves unrelated metadata keys", () => {
  const merged = mergeAllowedNewsChannels(
    { seed: "generic-demo", other: 1 },
    undefined,
    ["tempo"],
  );
  assert.equal(merged.seed, "generic-demo");
  assert.equal(merged.other, 1);
  assert.deepEqual(merged.allowed_news_channel_ids, ["tempo"]);
});

test("GET /news-feed/channels and feed enforce the tenant allowlist", async () => {
  const tenant = { metadata: { allowed_news_channel_ids: ["egi_media", "detik"] } };
  const server = await listenNewsFeed({ tenant });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const channels = await request(base, "/api/v1/news-feed/channels");
    assert.equal(channels.response.status, 200);
    assert.deepEqual(channels.body.data.items.map((item) => item.id), ["egi_media", "detik"]);
    assert.ok(channels.body.data.items.every((item) => item.label && item.layout && item.provider));

    const allowed = await request(base, "/api/v1/news-feed?channel=detik");
    assert.equal(allowed.response.status, 200);

    const denied = await request(base, "/api/v1/news-feed?channel=tempo");
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.error.code, "CHANNEL_NOT_ENTITLED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("omitted allowlist still exposes every visible news-feed channel", async () => {
  const server = await listenNewsFeed({ tenant: { metadata: { seed: "generic-demo" } } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const channels = await request(base, "/api/v1/news-feed/channels");
    assert.equal(channels.response.status, 200);
    assert.equal(channels.body.data.items.length, VISIBLE_IDS.length);
    assert.deepEqual(channels.body.data.items.map((item) => item.id), VISIBLE_IDS);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("crawl-poll and EGI poll are denied when the tenant is not entitled", async () => {
  const getTenantStore = () => ({
    get: async () => ({ metadata: { allowed_news_channel_ids: ["egi_media"] } }),
  });
  const queue = { enqueue: async () => { throw new Error("should not enqueue"); } };

  await assert.rejects(
    () => enqueueIngestTrigger({
      queue,
      tenantId: "tenant-1",
      companyId: "company-1",
      body: { mode: "crawl-poll", locale: "id", limit: 5, crawl_source_id: "detik" },
      idempotencyKey: "tenant-news-policy-01",
      getTenantStore,
    }),
    (error) => error.code === "CHANNEL_NOT_ENTITLED" && error.statusCode === 403,
  );

  const pollStore = () => ({
    get: async () => ({ metadata: { allowed_news_channel_ids: ["detik"] } }),
  });
  await assert.rejects(
    () => enqueueIngestTrigger({
      queue,
      tenantId: "tenant-1",
      companyId: "company-1",
      body: { mode: "poll", locale: "id", limit: 5 },
      idempotencyKey: "tenant-news-policy-02",
      getTenantStore: pollStore,
    }),
    (error) => error.code === "CHANNEL_NOT_ENTITLED",
  );
});

test("crawl ingest pollSource cannot bypass the tenant allowlist", async () => {
  const service = new CrawlIngestService({
    crawlArticleReader: { listArticlesSince: async () => { throw new Error("should not poll"); } },
    sourceGate: { requirePublishedArticle: async () => ({}) },
    snapshotStore: { upsert: async () => ({}) },
    watermarkStore: { get: async () => null, set: async () => ({}) },
    enqueueStageJob: async () => ({}),
    getTenantStore: () => ({ get: async () => ({ metadata: { allowed_news_channel_ids: ["egi_media"] } }) }),
  });
  await assert.rejects(
    () => service.pollSource({ tenantId: "tenant-1", companyId: "company-1", sourceId: "detik" }),
    (error) => error.code === "CHANNEL_NOT_ENTITLED",
  );
});

test("platform create and patch persist allowed_news_channel_ids without wiping metadata", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = `media-pack-${suffix}`;
  const companyId = `media-pack-co-${suffix}`;
  const ownerEmail = `owner-${suffix}@acme.example`;
  const server = new Server();
  const listener = await server.listen();
  const base = `http://localhost:${listener.address().port}`;
  try {
    const login = await request(base, "/api/v1/auth/login", {
      method: "POST",
      body: json({ email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: process.env.BOOTSTRAP_ADMIN_PASSWORD }),
    });
    assert.equal(login.response.status, 200);
    const platformHeaders = {
      Authorization: `Bearer ${login.body.data.access_token}`,
      "Idempotency-Key": `media-pack-create-${suffix}`,
    };

    const viral = await request(base, "/api/v1/platform/tenants", {
      method: "POST",
      headers: platformHeaders,
      body: json({ name: "Viral Pack", allowed_news_channel_ids: ["viral"] }),
    });
    assert.equal(viral.response.status, 400);

    const empty = await request(base, "/api/v1/platform/tenants", {
      method: "POST",
      headers: { ...platformHeaders, "Idempotency-Key": `media-pack-empty-${suffix}` },
      body: json({ name: "Empty Pack", allowed_news_channel_ids: [] }),
    });
    assert.equal(empty.response.status, 400);

    const created = await request(base, "/api/v1/platform/tenants", {
      method: "POST",
      headers: { ...platformHeaders, "Idempotency-Key": `media-pack-ok-${suffix}` },
      body: json({
        tenant_id: tenantId,
        name: "Media Pack",
        status: "active",
        metadata: { seed: "generic-demo" },
        allowed_news_channel_ids: ["egi_media", "detik"],
      }),
    });
    assert.equal(created.response.status, 201);
    assert.deepEqual(created.body.data.tenant.allowed_news_channel_ids, ["egi_media", "detik"]);
    assert.equal(created.body.data.tenant.metadata.seed, "generic-demo");

    const patched = await request(base, `/api/v1/platform/tenants/${tenantId}`, {
      method: "PATCH",
      headers: { ...platformHeaders, "Idempotency-Key": `media-pack-patch-${suffix}` },
      body: json({ allowed_news_channel_ids: ["tempo", "egi_media"] }),
    });
    assert.equal(patched.response.status, 200);
    assert.deepEqual(patched.body.data.tenant.allowed_news_channel_ids, ["tempo", "egi_media"]);
    assert.equal(patched.body.data.tenant.metadata.seed, "generic-demo");

    const company = await request(base, `/api/v1/platform/tenants/${tenantId}/companies`, {
      method: "POST",
      headers: { ...platformHeaders, "Idempotency-Key": `media-pack-co-${suffix}` },
      body: json({ company_id: companyId, name: "Media Co", status: "active" }),
    });
    assert.equal(company.response.status, 201);

    const owner = await request(base, `/api/v1/platform/tenants/${tenantId}/owner`, {
      method: "POST",
      headers: { ...platformHeaders, "Idempotency-Key": `media-pack-owner-${suffix}` },
      body: json({ email: ownerEmail, full_name: "Media Owner", password: "MediaOwner123!", company_id: companyId }),
    });
    assert.equal(owner.response.status, 201);

    const customerLogin = await request(base, "/api/v1/auth/login", {
      method: "POST",
      body: json({ email: ownerEmail, password: "MediaOwner123!" }),
    });
    assert.equal(customerLogin.response.status, 200);
    const customerHeaders = { Authorization: `Bearer ${customerLogin.body.data.access_token}` };

    const channels = await request(base, "/api/v1/news-feed/channels", { headers: customerHeaders });
    assert.equal(channels.response.status, 200);
    assert.deepEqual(channels.body.data.items.map((item) => item.id), ["egi_media", "tempo"]);

    const deniedFeed = await request(base, "/api/v1/news-feed?channel=detik", { headers: customerHeaders });
    assert.equal(deniedFeed.response.status, 403);
    assert.equal(deniedFeed.body.error.code, "CHANNEL_NOT_ENTITLED");

    const deniedCrawl = await request(base, "/api/v1/news-intake/pull", {
      method: "POST",
      headers: { ...customerHeaders, "Idempotency-Key": `media-pack-crawl-${suffix}` },
      body: json({ mode: "crawl-poll", locale: "id", limit: 5, crawl_source_id: "detik" }),
    });
    assert.equal(deniedCrawl.response.status, 403);
    assert.equal(deniedCrawl.body.error.code, "CHANNEL_NOT_ENTITLED");

    const omitted = await request(base, "/api/v1/platform/tenants", {
      method: "POST",
      headers: { ...platformHeaders, "Idempotency-Key": `media-pack-omitted-${suffix}` },
      body: json({ name: `Open Pack ${suffix}`, status: "active" }),
    });
    assert.equal(omitted.response.status, 201);
    assert.equal(omitted.body.data.tenant.allowed_news_channel_ids.length, VISIBLE_IDS.length);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});
