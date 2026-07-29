"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

const {
  CrawlIngestService,
  CrawlSourceGate,
  createIssueSourceResolver,
  formatCmsIssueSourceId,
  formatCrawlIssueSourceId,
  parseIssueSourceId,
} = require("../src/source");
const {
  ARTICLE_BY_HASH_SELECT,
  ARTICLE_SINCE_SELECT,
  CrawlArticleNotFoundError,
  CrawlSourceUnavailableError,
  createCrawlArticleReader,
} = require("../src/news-feed/crawl-article-reader");
const { assertCrawlReadOnlyQuery } = require("../src/database/crawl-db");
const { CmsSourceGate } = require("../src/cms/cms-source-gate");
const { mapError } = require("../src/app/error-contract");
const { createT02RelevanceRuntime } = require("../src/ai/tasks/t02-relevance-class");
const { createSourceRouter } = require("../src/routes/source");
const { createIngestRouter } = require("../src/routes/ingest");
const { InMemorySourceSnapshotStore, InMemoryWatermarkStore } = require("../src/ingest");

const CMS_UUID = "123e4567-e89b-12d3-a456-426614174000";
const CONTENT_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const CRAWL_ID = `crawl:detik:${CONTENT_HASH}`;

function crawlRow(overrides = {}) {
  return {
    article_id: "42",
    source_id: "detik",
    external_article_id: "detik-9001",
    canonical_url: "https://news.detik.com/berita/artikel-asli",
    normalized_url: "https://news.detik.com/berita/artikel-asli?utm=1",
    title: "Judul media",
    summary: "Ringkasan media",
    content_text: "Isi lengkap artikel media yang memuat konteks, kronologi, fakta pendukung, pihak terkait, dampak, dan tindak lanjut. ".repeat(6),
    thumbnail_url: "https://cdn.detik.com/thumb.jpg",
    published_at: "2026-07-26T10:00:00.000Z",
    collected_at: "2026-07-26T11:00:00.000Z",
    effective_timestamp: "2026-07-26T10:00:00.000Z",
    content_hash: CONTENT_HASH,
    ...overrides,
  };
}

function cmsArticle(overrides = {}) {
  return {
    id: CMS_UUID,
    title: "Artikel CMS",
    summary: "Ringkasan CMS",
    content: "Isi CMS",
    status: "published",
    published_at: "2026-07-22T10:00:00.000Z",
    updated_at: "2026-07-22T11:00:00.000Z",
    locale: "id",
    ...overrides,
  };
}

function fakeCrawlReader({ rows = [crawlRow()], onQuery = null } = {}) {
  const queries = [];
  const reader = createCrawlArticleReader({
    db: {
      query: async (sql, values) => {
        queries.push({ sql, values });
        if (onQuery) return onQuery({ sql, values });
        return { rows };
      },
    },
  });
  return { reader, queries };
}

function buildResolver({ rows, cmsClient, onQuery } = {}) {
  const cmsCalls = [];
  const cmsSourceGate = new CmsSourceGate({
    cmsArticleClient: cmsClient || {
      getArticleById: async (request) => { cmsCalls.push(request); return cmsArticle(); },
    },
    portalBaseUrl: "https://portal.example",
  });
  const { reader, queries } = fakeCrawlReader({ rows, onQuery });
  const resolver = createIssueSourceResolver({ cmsSourceGate, crawlArticleReader: reader });
  return { resolver, cmsCalls, crawlQueries: queries, cmsSourceGate, reader };
}

/* ------------------------------------------------------------------ *
 * B. ID format + backward compatibility
 * ------------------------------------------------------------------ */

test("F4 parses bare UUID, cms:<uuid>, and crawl:<source_id>:<content_hash>", () => {
  const bare = parseIssueSourceId(CMS_UUID);
  assert.equal(bare.provider, "cms");
  assert.equal(bare.legacyBareUuid, true);
  assert.equal(bare.cmsArticleId, CMS_UUID);
  assert.equal(bare.formatted, CMS_UUID);

  const prefixed = parseIssueSourceId(`cms:${CMS_UUID}`);
  assert.equal(prefixed.provider, "cms");
  assert.equal(prefixed.legacyBareUuid, false);
  assert.equal(prefixed.cmsArticleId, CMS_UUID);
  assert.equal(prefixed.formatted, `cms:${CMS_UUID}`);

  const crawl = parseIssueSourceId(CRAWL_ID);
  assert.equal(crawl.provider, "crawl");
  assert.equal(crawl.sourceId, "detik");
  assert.equal(crawl.contentHash, CONTENT_HASH);
  assert.equal(crawl.formatted, CRAWL_ID);
});

test("F4 rejects viral, unknown prefixes, malformed keys, and non-issue channels", () => {
  const cases = [
    { input: "viral:12345", code: "ISSUE_SOURCE_VIRAL_REJECTED" },
    { input: "viral_x:12345", code: "ISSUE_SOURCE_VIRAL_REJECTED" },
    { input: "crawl:viral:" + CONTENT_HASH, code: "ISSUE_SOURCE_CRAWL_CHANNEL_INVALID" },
    { input: "crawl:egi_media:" + CONTENT_HASH, code: "ISSUE_SOURCE_CRAWL_CHANNEL_INVALID" },
    { input: "crawl:kompas:" + CONTENT_HASH, code: "ISSUE_SOURCE_CRAWL_CHANNEL_INVALID" },
    { input: "crawl:detik:", code: "ISSUE_SOURCE_ID_INVALID" },
    { input: "crawl:detik:not*hex", code: "ISSUE_SOURCE_ID_INVALID" },
    { input: "crawl:detik", code: "ISSUE_SOURCE_ID_INVALID" },
    { input: "cms:not-a-uuid", code: "ISSUE_SOURCE_ID_INVALID" },
    { input: "x:1", code: "ISSUE_SOURCE_ID_INVALID" },
    { input: "not-a-uuid", code: "ISSUE_SOURCE_ID_INVALID" },
    { input: "", code: "ISSUE_SOURCE_ID_INVALID" },
    { input: null, code: "ISSUE_SOURCE_ID_INVALID" },
  ];
  for (const item of cases) {
    assert.throws(() => parseIssueSourceId(item.input), (error) => {
      assert.equal(error.code, item.code, `input=${String(item.input)}`);
      assert.equal(error.retryable, false);
      return true;
    });
  }
});

test("F4 formatters mint only registered issue source ids", () => {
  assert.equal(formatCmsIssueSourceId(CMS_UUID), `cms:${CMS_UUID}`);
  assert.equal(formatCrawlIssueSourceId({ sourceId: "tempo", contentHash: CONTENT_HASH }), `crawl:tempo:${CONTENT_HASH}`);
  assert.throws(() => formatCmsIssueSourceId("nope"), { code: "ISSUE_SOURCE_ID_INVALID" });
  assert.throws(() => formatCrawlIssueSourceId({ sourceId: "viral", contentHash: CONTENT_HASH }), {
    code: "ISSUE_SOURCE_CRAWL_CHANNEL_INVALID",
  });
  assert.throws(() => formatCrawlIssueSourceId({ sourceId: "detik", contentHash: "bad:hash" }), {
    code: "ISSUE_SOURCE_ID_INVALID",
  });
});

/* ------------------------------------------------------------------ *
 * A. Source resolution routing
 * ------------------------------------------------------------------ */

test("F4 bare UUID and cms:<uuid> both resolve through the untouched CMS gate", async () => {
  const { resolver, cmsCalls, crawlQueries } = buildResolver();

  const legacy = await resolver.requirePublishedArticle({ articleId: CMS_UUID, locale: "en" });
  const prefixed = await resolver.requirePublishedArticle({ articleId: `cms:${CMS_UUID}`, locale: "en" });

  assert.deepEqual(cmsCalls, [{ articleId: CMS_UUID, locale: "en" }, { articleId: CMS_UUID, locale: "en" }]);
  assert.equal(crawlQueries.length, 0);
  assert.equal(legacy.sourceArticleId, CMS_UUID);
  assert.equal(legacy.canonicalUrl, `https://portal.example/en/articles/${CMS_UUID}`);
  assert.equal(legacy.article.status, "published");
  assert.equal(legacy.requestedLocale, "en");
  assert.equal(legacy.contentLocale, "id");
  assert.deepEqual(
    { ...legacy, metadata: { ...legacy.metadata } },
    { ...prefixed, metadata: { ...prefixed.metadata } }
  );
  assert.equal(legacy.provider, "cms");
  assert.equal(legacy.issueSourceId, `cms:${CMS_UUID}`);
  assert.ok(Object.hasOwn(legacy.metadata, "thumbnail_url"));
  assert.equal(legacy.metadata.thumbnail_url, null);
});

test("F4 CMS featured_image is carried into source metadata thumbnail_url", async () => {
  const { resolver } = buildResolver({
    cmsClient: { getArticleById: async () => cmsArticle({ featured_image: "https://cdn.portal.example/a.jpg" }) },
  });
  const source = await resolver.requirePublishedArticle({ articleId: CMS_UUID, locale: "id" });
  assert.equal(source.metadata.thumbnail_url, "https://cdn.portal.example/a.jpg");
});

test("F4 crawl reference resolves to a CMS-shaped source citing the original media URL", async () => {
  const { resolver, cmsCalls, crawlQueries } = buildResolver();

  const source = await resolver.requirePublishedArticle({ articleId: CRAWL_ID, locale: "id" });

  assert.equal(cmsCalls.length, 0);
  assert.deepEqual(crawlQueries[0].values, ["detik", CONTENT_HASH]);
  assert.equal(source.sourceArticleId, CRAWL_ID);
  assert.equal(source.requestedLocale, "id");
  assert.equal(source.contentLocale, "id");
  assert.equal(source.canonicalUrl, "https://news.detik.com/berita/artikel-asli");
  assert.doesNotMatch(source.canonicalUrl, /portal\.example/);
  assert.equal(source.provider, "crawl");
  assert.equal(source.issueSourceId, CRAWL_ID);
  assert.equal(source.metadata.thumbnail_url, "https://cdn.detik.com/thumb.jpg");
  assert.equal(source.metadata.crawl_source_id, "detik");
  assert.equal(source.metadata.content_hash, CONTENT_HASH);
  assert.deepEqual(source.article, {
    id: CRAWL_ID,
    title: "Judul media",
    summary: "Ringkasan media",
    content: crawlRow().content_text,
    status: "published",
    publishedAt: "2026-07-26T10:00:00.000Z",
    updatedAt: null,
  });
  assert.ok(Object.isFrozen(source));
  assert.ok(Object.isFrozen(source.article));
  assert.ok(Object.isFrozen(source.metadata));
});

test("F4 crawl source keeps the same field contract as the CMS gate", async () => {
  const { resolver } = buildResolver();
  const cms = await resolver.requirePublishedArticle({ articleId: CMS_UUID, locale: "id" });
  const crawl = await resolver.requirePublishedArticle({ articleId: CRAWL_ID, locale: "id" });
  assert.deepEqual(Object.keys(crawl).sort(), Object.keys(cms).sort());
  assert.deepEqual(Object.keys(crawl.article).sort(), Object.keys(cms.article).sort());
});

test("F4 crawl canonical URL falls back to normalized_url and thumbnail_url stays nullable", async () => {
  const { resolver } = buildResolver({
    rows: [crawlRow({ canonical_url: null, thumbnail_url: null, published_at: null })],
  });
  const source = await resolver.requirePublishedArticle({ articleId: CRAWL_ID, locale: "id" });
  assert.equal(source.canonicalUrl, "https://news.detik.com/berita/artikel-asli?utm=1");
  assert.ok(Object.hasOwn(source.metadata, "thumbnail_url"));
  assert.equal(source.metadata.thumbnail_url, null);
  assert.equal(source.article.publishedAt, "2026-07-26T11:00:00.000Z");
});

test("F4 crawl article without any citable URL is rejected as malformed", async () => {
  const { resolver } = buildResolver({ rows: [crawlRow({ canonical_url: null, normalized_url: null })] });
  await assert.rejects(resolver.requirePublishedArticle({ articleId: CRAWL_ID, locale: "id" }), {
    code: "CRAWL_SOURCE_MALFORMED_ARTICLE",
  });
});

test("F4 viral references never reach the CMS gate or the crawl reader", async () => {
  let cmsCalled = false;
  let crawlCalled = false;
  const resolver = createIssueSourceResolver({
    cmsSourceGate: { requirePublishedArticle: async () => { cmsCalled = true; return {}; }, cmsArticleClient: {} },
    crawlArticleReader: { getArticleByContentHash: async () => { crawlCalled = true; return {}; } },
  });

  for (const articleId of ["viral:tweet-1", "viral_x:tweet-1", "crawl:viral:" + CONTENT_HASH]) {
    await assert.rejects(resolver.requirePublishedArticle({ articleId, locale: "id" }), (error) => {
      assert.ok(["ISSUE_SOURCE_VIRAL_REJECTED", "ISSUE_SOURCE_CRAWL_CHANNEL_INVALID"].includes(error.code));
      return true;
    });
  }
  assert.equal(cmsCalled, false);
  assert.equal(crawlCalled, false);
});

test("F4 crawl gate rejects unsupported locales before touching the crawl store", async () => {
  let called = false;
  const gate = new CrawlSourceGate({
    crawlArticleReader: { getArticleByContentHash: async () => { called = true; return { row: crawlRow() }; } },
  });
  await assert.rejects(gate.requirePublishedArticle({ articleId: CRAWL_ID, locale: "fr" }), {
    code: "CMS_SOURCE_LOCALE_INVALID",
  });
  assert.equal(called, false);
});

/* ------------------------------------------------------------------ *
 * C. Reader single-article + watermark support
 * ------------------------------------------------------------------ */

test("F4 single-article and watermark SQL stay read-only and validity filtered", () => {
  for (const sql of [ARTICLE_BY_HASH_SELECT, ARTICLE_SINCE_SELECT]) {
    assert.doesNotThrow(() => assertCrawlReadOnlyQuery(sql));
    assert.match(sql, /FROM articles/i);
    assert.match(sql, /validation_status\s*=\s*'valid'/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i);
  }
  assert.match(ARTICLE_BY_HASH_SELECT, /content_hash\s*=\s*\$2/i);
  assert.match(ARTICLE_BY_HASH_SELECT, /LIMIT 1/i);
});

test("F4 crawl reader emits only SELECT statements", async () => {
  const { reader, queries } = fakeCrawlReader();
  await reader.getArticleByContentHash({ sourceId: "detik", contentHash: CONTENT_HASH });
  await reader.listArticlesSince({ sourceId: "detik", since: null, limit: 5 });
  assert.equal(queries.length, 2);
  for (const entry of queries) {
    assert.match(entry.sql.trim(), /^SELECT/i);
    assert.doesNotThrow(() => assertCrawlReadOnlyQuery(entry.sql));
  }
});

test("F4 missing crawl article maps to a structured not-found error", async () => {
  const { reader } = fakeCrawlReader({ rows: [] });
  await assert.rejects(
    reader.getArticleByContentHash({ sourceId: "detik", contentHash: CONTENT_HASH }),
    (error) => error instanceof CrawlArticleNotFoundError
      && error.code === "CRAWL_SOURCE_NOT_FOUND"
      && error.retryable === false
  );
});

test("F4 crawl unavailability and timeouts stay retryable for single fetches", async () => {
  const unavailable = createCrawlArticleReader({
    db: { query: async () => { throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }); } },
  });
  await assert.rejects(
    unavailable.getArticleByContentHash({ sourceId: "detik", contentHash: CONTENT_HASH }),
    (error) => error instanceof CrawlSourceUnavailableError
      && error.code === "CRAWL_SOURCE_UNAVAILABLE"
      && error.retryable === true
  );

  const timedOut = createCrawlArticleReader({ db: { query: () => new Promise(() => {}) }, queryTimeoutMs: 10 });
  await assert.rejects(
    timedOut.getArticleByContentHash({ sourceId: "detik", contentHash: CONTENT_HASH }),
    (error) => error instanceof CrawlSourceUnavailableError
      && error.retryable === true
      && error.cause?.code === "CRAWL_QUERY_TIMEOUT"
  );
});

test("F4 reader rejects unknown and non-issue crawl channels for single fetches", async () => {
  const { reader, queries } = fakeCrawlReader();
  for (const sourceId of ["kompas", "viral", "egi_media"]) {
    await assert.rejects(reader.getArticleByContentHash({ sourceId, contentHash: CONTENT_HASH }), {
      code: "INVALID_CRAWL_CHANNEL",
    });
  }
  assert.equal(queries.length, 0);
});

test("F4 watermark listing orders ascending and returns the next watermark", async () => {
  const rows = [
    crawlRow({ article_id: "50", effective_timestamp: "2026-07-26T12:00:00.000Z", content_hash: "aaaaaaaa" }),
    crawlRow({ article_id: "51", effective_timestamp: "2026-07-26T13:00:00.000Z", content_hash: "bbbbbbbb" }),
  ];
  const { reader, queries } = fakeCrawlReader({ rows });

  const page = await reader.listArticlesSince({ sourceId: "detik", since: "2026-07-26T11:00:00.000Z", limit: 10 });

  assert.match(queries[0].sql, /COALESCE\(published_at, collected_at\) ASC,\s*article_id ASC/i);
  assert.deepEqual(queries[0].values, ["detik", "2026-07-26T11:00:00.000Z", 10]);
  assert.deepEqual(page.items.map((item) => item.issue_source_id), ["crawl:detik:aaaaaaaa", "crawl:detik:bbbbbbbb"]);
  assert.equal(page.watermark, "2026-07-26T13:00:00.000Z");
  assert.ok(Object.hasOwn(page.items[0], "thumbnail_url"));
});

/* ------------------------------------------------------------------ *
 * D. Pipeline + ingest wiring
 * ------------------------------------------------------------------ */

test("F4 T02 classifies a crawl-sourced article through the same service entry point", async () => {
  const { resolver } = buildResolver();
  const runtime = createT02RelevanceRuntime({
    aiTaskKernel: {
      execute: async (request) => ({
        data: { relevance: "high", confidence: 0.77, subject_relation: "market" },
        model: { alias: "nano", name: "nano-test-model" },
        correlation: { requestId: request.requestId, providerRequestId: "req_t02" },
        providerResponseId: "resp_t02",
        usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
        latencyMs: 12,
      }),
    },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    cmsSourceGate: resolver,
    getEffectiveContext: async () => ({
      companyId: "company-1",
      version: 3,
      status: "effective",
      fields: {
        name: "PT Example", industry: "Media logistics", sub_industry: null, description: null,
        products: ["Media distribution", "Fleet tracking"], customers: [], regions: [], competitors: [],
        brands_aliases: [],
        key_people: [],
        priorities: [], goals: [], risks: [], topics: [], dependencies: [],
      },
    }),
    authorizeCompany: async ({ companyId }) => companyId === "company-1",
  });

  const crawl = await runtime.service.classify({ companyId: "company-1", articleId: CRAWL_ID, locale: "id" });
  const cms = await runtime.service.classify({ companyId: "company-1", articleId: CMS_UUID, locale: "id" });

  assert.equal(crawl.decision.articleId, CRAWL_ID);
  assert.equal(crawl.decision.source.sourceArticleId, CRAWL_ID);
  assert.equal(crawl.decision.source.canonicalUrl, "https://news.detik.com/berita/artikel-asli");
  assert.equal(crawl.shouldContinue, true);
  assert.equal(cms.decision.articleId, CMS_UUID);
  assert.equal(cms.decision.source.canonicalUrl, `https://portal.example/id/articles/${CMS_UUID}`);
  assert.notEqual(crawl.decision.inputFingerprint, cms.decision.inputFingerprint);
});

test("F4 T02 refuses a viral article id without calling the model", async () => {
  let kernelCalls = 0;
  const { resolver } = buildResolver();
  const runtime = createT02RelevanceRuntime({
    aiTaskKernel: { execute: async () => { kernelCalls += 1; return {}; } },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    cmsSourceGate: resolver,
    getEffectiveContext: async () => ({ companyId: "company-1", version: 1, status: "effective", fields: {} }),
    authorizeCompany: async () => true,
  });
  await assert.rejects(
    runtime.service.classify({ companyId: "company-1", articleId: "viral:tweet-1", locale: "id" }),
    { code: "ISSUE_SOURCE_VIRAL_REJECTED" }
  );
  assert.equal(kernelCalls, 0);
});

test("F4 crawl ingest snapshots new articles per source and advances the watermark", async () => {
  const { resolver, reader } = buildResolver({
    rows: [
      crawlRow({ article_id: "60", content_hash: "cccccccc", effective_timestamp: "2026-07-26T14:00:00.000Z" }),
    ],
  });
  const jobs = [];
  const snapshotStore = new InMemorySourceSnapshotStore({ uuid: () => "snapshot-1", now: () => 0 });
  const watermarkStore = new InMemoryWatermarkStore({ now: () => 0 });
  const service = new CrawlIngestService({
    crawlArticleReader: reader,
    sourceGate: resolver,
    snapshotStore,
    watermarkStore,
    enqueueStageJob: async (job) => { jobs.push(job); return { jobId: `stage-${jobs.length}` }; },
    now: () => Date.parse("2026-07-26T15:00:00.000Z"),
  });

  const result = await service.pollSource({
    tenantId: "tenant-1", companyId: "company-1", sourceId: "detik", locale: "id", limit: 10,
  });

  assert.equal(result.count, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].stage, "relevance");
  assert.equal(jobs[0].sourceArticleId, "crawl:detik:cccccccc");
  assert.equal(result.snapshots[0].canonicalUrl, "https://news.detik.com/berita/artikel-asli");
  assert.equal(result.watermark.watermark, "2026-07-26T14:00:00.000Z");
  assert.equal(
    (await watermarkStore.get({ sourceName: "crawl:detik", locale: "id" })).watermark,
    "2026-07-26T14:00:00.000Z"
  );
});

test("F4 crawl ingest refuses channels that do not feed issues", async () => {
  const { resolver, reader } = buildResolver();
  const service = new CrawlIngestService({
    crawlArticleReader: reader,
    sourceGate: resolver,
    snapshotStore: new InMemorySourceSnapshotStore(),
    watermarkStore: new InMemoryWatermarkStore(),
    enqueueStageJob: async () => { throw new Error("must not enqueue"); },
  });
  for (const sourceId of ["viral", "egi_media", "kompas"]) {
    await assert.rejects(
      service.pollSource({ tenantId: "t", companyId: "c", sourceId, locale: "id" }),
      { code: "ISSUE_SOURCE_CRAWL_CHANNEL_INVALID" }
    );
  }
});

/* ------------------------------------------------------------------ *
 * HTTP surface (source boundary + ingest trigger)
 * ------------------------------------------------------------------ */

async function listenRouter(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authContext = { actor: { actorId: "actor-1" }, tenantId: "tenant-1", companyId: "company-1", scopeTrusted: true };
    next();
  });
  app.use(router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

test("F4 internal source boundary serves crawl and CMS ids through one route", async () => {
  const { resolver } = buildResolver();
  const server = await listenRouter(createSourceRouter({ getIssueSourceResolver: () => resolver }));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/v1/internal/source/articles`;

    const crawl = await (await fetch(`${base}/${encodeURIComponent(CRAWL_ID)}?locale=id`)).json();
    assert.equal(crawl.success, true);
    assert.equal(crawl.data.provider, "crawl");
    assert.equal(crawl.data.source_article_id, CRAWL_ID);
    assert.equal(crawl.data.citation_url, "https://news.detik.com/berita/artikel-asli");
    assert.equal(crawl.data.thumbnail_url, "https://cdn.detik.com/thumb.jpg");

    const cms = await (await fetch(`${base}/${CMS_UUID}?locale=id`)).json();
    assert.equal(cms.data.provider, "cms");
    assert.equal(cms.data.source_article_id, CMS_UUID);
    assert.equal(cms.data.citation_url, `https://portal.example/id/articles/${CMS_UUID}`);

    const viral = await fetch(`${base}/${encodeURIComponent("viral:tweet-1")}`);
    const viralBody = await viral.json();
    assert.equal(viral.status, 400);
    assert.equal(viralBody.error.code, "ISSUE_SOURCE_VIRAL_REJECTED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("F4 ingest trigger accepts crawl-poll only for registered crawl sources", async () => {
  const enqueued = [];
  const router = createIngestRouter({
    getIngestRuntime: () => ({
      queue: {
        enqueue: async (job) => {
          enqueued.push(job);
          return { job: { jobId: "job-1", status: "queued", updatedAt: "2026-07-26T00:00:00.000Z" }, reused: false };
        },
      },
    }),
  });
  const server = await listenRouter(router);
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/v1/internal/pipeline/ingest`;
    const headers = { "Content-Type": "application/json", "Idempotency-Key": "idempotency-key-0001" };

    const ok = await fetch(url, {
      method: "POST", headers, body: JSON.stringify({ mode: "crawl-poll", locale: "id", crawl_source_id: "detik" }),
    });
    assert.equal(ok.status, 202);
    assert.equal(enqueued[0].jobType, "crawl.poll");
    assert.equal(enqueued[0].payload.crawl_source_id, "detik");

    for (const body of [
      { mode: "crawl-poll", locale: "id" },
      { mode: "crawl-poll", locale: "id", crawl_source_id: "viral" },
      { mode: "crawl-poll", locale: "id", crawl_source_id: "kompas" },
    ]) {
      const bad = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(bad.status, 400);
      assert.equal((await bad.json()).error.code, "VALIDATION_ERROR");
    }
    assert.equal(enqueued.length, 1);

    const cmsPoll = await fetch(url, { method: "POST", headers, body: JSON.stringify({ mode: "poll", locale: "id" }) });
    assert.equal(cmsPoll.status, 202);
    assert.equal(enqueued[1].jobType, "cms.poll");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ------------------------------------------------------------------ *
 * Error contract mapping
 * ------------------------------------------------------------------ */

test("F4 new source error codes map to the shared HTTP error contract", () => {
  assert.deepEqual(mapError({ code: "CRAWL_SOURCE_NOT_FOUND" }), {
    status: 404, code: "CRAWL_SOURCE_NOT_FOUND", message: "Source article was not found", retryable: false,
  });
  assert.deepEqual(mapError({ code: "CRAWL_SOURCE_UNAVAILABLE", retryable: true }), {
    status: 503, code: "CRAWL_SOURCE_UNAVAILABLE", message: "Crawl article source is temporarily unavailable", retryable: true,
  });
  assert.equal(mapError({ code: "ISSUE_SOURCE_ID_INVALID" }).status, 400);
  assert.equal(mapError({ code: "ISSUE_SOURCE_VIRAL_REJECTED" }).status, 400);
  assert.equal(mapError({ code: "ISSUE_SOURCE_CRAWL_CHANNEL_INVALID" }).status, 400);
  assert.equal(mapError({ code: "CRAWL_SOURCE_MALFORMED_ARTICLE" }).status, 502);
});
