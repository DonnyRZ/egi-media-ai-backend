"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

const { createNewsFeedService } = require("../src/news-feed/news-feed.service");
const { createNewsFeedRouter } = require("../src/routes/news-feed");
const { InMemoryCrawlIndustryDecisionStore } = require("../src/news-feed/in-memory-crawl-industry-decision.store");
const { createCrawlIndustryScoreLoop } = require("../src/news-feed/crawl-industry-score.loop");
const { createCrawlArticleReader, encodeCursor } = require("../src/news-feed/crawl-article-reader");
const { PostgresCrawlIndustryDecisionStore } = require("../src/persistence/postgres-crawl-industry-decision.store");

function crawlItem(overrides = {}) {
  return {
    id: "crawl:detik:hash-1",
    channel: "detik",
    provider: "crawl",
    layout: "card",
    title: "Cloud region baru",
    summary: "Ringkasan",
    published_at: "2026-08-12T10:00:00.000Z",
    source_url: "https://canonical.example/article",
    thumbnail_url: null,
    crawl_source_id: "detik",
    issue_source_id: "crawl:detik:hash-1",
    source_label: "Detik",
    ...overrides,
  };
}

function listen({ service, tenantId = "tenant-1", v4 = { enabled: false, tenantId: "it-holding" } } = {}) {
  const app = express();
  app.use((req, _res, next) => {
    req.authContext = {
      actor: { actorId: "actor-1" },
      tenantId,
      companyId: "company-1",
      scopeTrusted: true,
    };
    next();
  });
  app.use(createNewsFeedRouter({
    getNewsFeedService: () => service,
    getNewsFeedV4Config: () => v4,
  }));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("lexical mixed feed still sends IT_FEED_TERMS for non-v4 tenants", async () => {
  const calls = [];
  const service = createNewsFeedService({
    crawlArticleReader: {
      listArticles: async () => ({ items: [], next_cursor: null }),
      listMixedArticles: async (request) => {
        calls.push(request);
        return { items: [crawlItem()], next_cursor: null };
      },
    },
    cmsArticleClient: { listPublishedArticles: async () => ({ items: [], nextCursor: null }) },
    portalBaseUrl: "http://portal.example",
  });
  const server = await listen({
    service,
    tenantId: "acme",
    v4: { enabled: true, tenantId: "it-holding" },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed?view=mixed&limit=20`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.items[0].title, "Cloud region baru");
    assert.ok(calls[0].terms.includes("siber"));
    assert.notEqual(calls[0].industryFilter, "it-v4");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("it-holding mixed feed lists only admitted v4 rows and hydrates crawl", async () => {
  const store = new InMemoryCrawlIndustryDecisionStore({ uuid: () => "decision-1" });
  await store.upsert({
    sourceId: "detik",
    contentHash: "keep",
    sourceArticleId: "crawl:detik:keep",
    crawlArticleId: "44",
    effectiveTimestamp: "2026-08-12T12:00:00.000Z",
    industryId: "it",
    admit: true,
    stage1Score: 0.9,
    stage2Score: 0.9,
    stage1Threshold: 0.29,
    stage2Threshold: 0.38,
    modelVersion: "it-v4",
    mode: "news_feed_v4",
  });
  await store.upsert({
    sourceId: "detik",
    contentHash: "drop",
    sourceArticleId: "crawl:detik:drop",
    crawlArticleId: "43",
    effectiveTimestamp: "2026-08-12T11:00:00.000Z",
    industryId: "it",
    admit: false,
    stage1Score: 0.1,
    stage2Score: 0.1,
    stage1Threshold: 0.29,
    stage2Threshold: 0.38,
    modelVersion: "it-v4",
    mode: "news_feed_v4",
  });
  const keyCalls = [];
  const mixedCalls = [];
  const service = createNewsFeedService({
    crawlArticleReader: {
      listArticles: async () => ({ items: [], next_cursor: null }),
      listMixedArticles: async (request) => {
        mixedCalls.push(request);
        return { items: [crawlItem({ title: "should-not-use-keywords" })], next_cursor: null };
      },
      listArticlesByKeys: async (keys) => {
        keyCalls.push(keys);
        return keys.map((key) => (key.contentHash === "keep"
          ? crawlItem({ id: "crawl:detik:keep", title: "Admitted IT" })
          : null));
      },
    },
    cmsArticleClient: { listPublishedArticles: async () => ({ items: [], nextCursor: null }) },
    portalBaseUrl: "http://portal.example",
    crawlIndustryDecisionStore: store,
  });
  const server = await listen({
    service,
    tenantId: "it-holding",
    v4: { enabled: true, tenantId: "it-holding" },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed?view=mixed&limit=20`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(mixedCalls.length, 0);
    assert.deepEqual(keyCalls[0], [{ sourceId: "detik", contentHash: "keep" }]);
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.items[0].title, "Admitted IT");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("v4 mixed feed cursor pages admitted rows and skips missing crawl rows", async () => {
  const store = new InMemoryCrawlIndustryDecisionStore();
  await store.upsert({
    sourceId: "detik", contentHash: "a", sourceArticleId: "crawl:detik:a", crawlArticleId: "30",
    effectiveTimestamp: "2026-08-12T12:00:00.000Z", industryId: "it", admit: true,
    modelVersion: "it-v4", mode: "news_feed_v4",
  });
  await store.upsert({
    sourceId: "tempo", contentHash: "b", sourceArticleId: "crawl:tempo:b", crawlArticleId: "20",
    effectiveTimestamp: "2026-08-12T11:00:00.000Z", industryId: "it", admit: true,
    modelVersion: "it-v4", mode: "news_feed_v4",
  });
  await store.upsert({
    sourceId: "detik", contentHash: "c", sourceArticleId: "crawl:detik:c", crawlArticleId: "10",
    effectiveTimestamp: "2026-08-12T10:00:00.000Z", industryId: "it", admit: true,
    modelVersion: "it-v4", mode: "news_feed_v4",
  });
  const service = createNewsFeedService({
    crawlArticleReader: {
      listArticles: async () => ({ items: [], next_cursor: null }),
      listArticlesByKeys: async (keys) => keys.map((key) => {
        if (key.contentHash === "b") return null;
        return crawlItem({
          id: `crawl:${key.sourceId}:${key.contentHash}`,
          channel: key.sourceId,
          crawl_source_id: key.sourceId,
          title: key.contentHash,
        });
      }),
    },
    cmsArticleClient: { listPublishedArticles: async () => ({ items: [], nextCursor: null }) },
    portalBaseUrl: "http://portal.example",
    crawlIndustryDecisionStore: store,
  });
  const first = await service.listMixedFeed({
    sourceIds: ["detik", "tempo"],
    limit: 2,
    industryFilter: "it-v4",
  });
  assert.deepEqual(first.items.map((item) => item.title), ["a"]);
  assert.ok(first.next_cursor);
  const second = await service.listMixedFeed({
    sourceIds: ["detik", "tempo"],
    cursor: first.next_cursor,
    limit: 2,
    industryFilter: "it-v4",
  });
  assert.deepEqual(second.items.map((item) => item.title), ["c"]);
  assert.equal(second.next_cursor, null);
});

test("decision store upsert is idempotent and cursor advances", async () => {
  const store = new InMemoryCrawlIndustryDecisionStore({ uuid: () => "same-id" });
  const first = await store.upsert({
    sourceId: "detik", contentHash: "h1", sourceArticleId: "crawl:detik:h1", crawlArticleId: "9",
    effectiveTimestamp: "2026-08-01T00:00:00.000Z", industryId: "it", admit: false,
    modelVersion: "it-v4", mode: "news_feed_v4",
  });
  const second = await store.upsert({
    sourceId: "detik", contentHash: "h1", sourceArticleId: "crawl:detik:h1", crawlArticleId: "9",
    effectiveTimestamp: "2026-08-01T00:00:00.000Z", industryId: "it", admit: true,
    modelVersion: "it-v4", mode: "news_feed_v4",
  });
  assert.equal(first.decisionId, second.decisionId);
  assert.equal(second.admit, true);
  await store.setCursor({ sourceId: "detik", modelVersion: "it-v4", watermark: "2026-08-01T00:00:00.000Z" });
  const cursor = await store.getCursor({ sourceId: "detik", modelVersion: "it-v4" });
  assert.equal(cursor.watermark, "2026-08-01T00:00:00.000Z");
});

test("score loop skips existing, upserts new, and does not advance past a scorer error", async () => {
  const store = new InMemoryCrawlIndustryDecisionStore();
  await store.upsert({
    sourceId: "detik", contentHash: "old", sourceArticleId: "crawl:detik:old", crawlArticleId: "1",
    effectiveTimestamp: "2026-08-10T00:00:00.000Z", industryId: "it", admit: false,
    modelVersion: "it-v4", mode: "news_feed_v4",
  });
  const scores = [];
  const loop = createCrawlIndustryScoreLoop({
    crawlArticleReader: {
      listScoringCandidates: async () => ({
        items: [
          {
            sourceId: "detik", contentHash: "old", crawlArticleId: "1",
            sourceArticleId: "crawl:detik:old", title: "old", summary: "",
            effectiveTimestamp: "2026-08-10T00:00:00.000Z",
          },
          {
            sourceId: "detik", contentHash: "new", crawlArticleId: "2",
            sourceArticleId: "crawl:detik:new", title: "Cloud", summary: "SaaS",
            effectiveTimestamp: "2026-08-11T00:00:00.000Z",
          },
          {
            sourceId: "detik", contentHash: "fail", crawlArticleId: "3",
            sourceArticleId: "crawl:detik:fail", title: "x", summary: "y",
            effectiveTimestamp: "2026-08-12T00:00:00.000Z",
          },
        ],
        watermark: "2026-08-12T00:00:00.000Z",
      }),
    },
    decisionStore: store,
    scorer: {
      score: async ({ title }) => {
        scores.push(title);
        if (title === "x") return { ok: false, error: "timeout" };
        return {
          ok: true, admit: true, stage1: 0.8, stage2: 0.8,
          stage1Threshold: 0.29, stage2Threshold: 0.38, modelVersion: "it-v4",
          composition: "AND", scorerMs: 12,
        };
      },
    },
    sourceIds: ["detik"],
    lookbackDays: 14,
    maxArticlesPerTick: 50,
    now: () => Date.parse("2026-08-13T00:00:00.000Z"),
    logger: { info() {}, warn() {}, error() {} },
  });
  const stats = await loop.tick();
  assert.equal(stats.skippedExisting, 1);
  assert.equal(stats.scored, 1);
  assert.equal(stats.admitted, 1);
  assert.equal(stats.errors, 1);
  assert.deepEqual(scores, ["Cloud", "x"]);
  const saved = await store.get({ sourceId: "detik", contentHash: "new", industryId: "it", modelVersion: "it-v4" });
  assert.equal(saved.admit, true);
  const failed = await store.get({ sourceId: "detik", contentHash: "fail", industryId: "it", modelVersion: "it-v4" });
  assert.equal(failed, null);
  const cursor = await store.getCursor({ sourceId: "detik", modelVersion: "it-v4" });
  assert.equal(cursor.watermark, "2026-08-11T00:00:00.000Z");
});

test("postgres crawl industry store upserts and lists admitted with cursor", async () => {
  const calls = [];
  const db = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (String(sql).includes("INSERT INTO ai.crawl_industry_decisions")) {
        return {
          rows: [{
            id: values[0],
            source_id: values[1],
            content_hash: values[2],
            source_article_id: values[3],
            crawl_article_id: values[4],
            effective_timestamp: values[5],
            industry_id: values[6],
            admit: values[7],
            stage1_score: values[8],
            stage2_score: values[9],
            stage1_threshold: values[10],
            stage2_threshold: values[11],
            model_version: values[12],
            mode: values[13],
            payload_jsonb: JSON.parse(values[14]),
            created_at: "2026-08-13T00:00:00.000Z",
          }],
        };
      }
      if (String(sql).includes("FROM ai.crawl_industry_decisions") && String(sql).includes("admit IS TRUE")) {
        return {
          rows: [{
            id: "d1",
            source_id: "detik",
            content_hash: "h1",
            source_article_id: "crawl:detik:h1",
            crawl_article_id: "44",
            effective_timestamp: "2026-08-12T12:00:00.000Z",
            industry_id: "it",
            admit: true,
            stage1_score: 0.9,
            stage2_score: 0.8,
            stage1_threshold: 0.29,
            stage2_threshold: 0.38,
            model_version: "it-v4",
            mode: "news_feed_v4",
            payload_jsonb: {},
            created_at: "2026-08-13T00:00:00.000Z",
          }, {
            id: "d2",
            source_id: "tempo",
            content_hash: "h2",
            source_article_id: "crawl:tempo:h2",
            crawl_article_id: "43",
            effective_timestamp: "2026-08-12T11:00:00.000Z",
            industry_id: "it",
            admit: true,
            stage1_score: 0.7,
            stage2_score: 0.7,
            stage1_threshold: 0.29,
            stage2_threshold: 0.38,
            model_version: "it-v4",
            mode: "news_feed_v4",
            payload_jsonb: {},
            created_at: "2026-08-13T00:00:00.000Z",
          }],
        };
      }
      return { rows: [] };
    },
  };
  const store = new PostgresCrawlIndustryDecisionStore({ db, uuid: () => "id-1" });
  const saved = await store.upsert({
    sourceId: "detik",
    contentHash: "h1",
    sourceArticleId: "crawl:detik:h1",
    crawlArticleId: 44,
    effectiveTimestamp: "2026-08-12T12:00:00.000Z",
    industryId: "it",
    admit: true,
    stage1Score: 0.9,
    stage2Score: 0.8,
    stage1Threshold: 0.29,
    stage2Threshold: 0.38,
    modelVersion: "it-v4",
    mode: "news_feed_v4",
    payload: { composition: "AND" },
  });
  assert.equal(saved.admit, true);
  const page = await store.listAdmitted({ sourceIds: ["detik", "tempo"], limit: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].contentHash, "h1");
  assert.ok(page.next_cursor);
  assert.equal(page.next_cursor, encodeCursor({
    effectiveTimestamp: "2026-08-12T12:00:00.000Z",
    articleId: "44",
  }));
});

test("v4 hydrate reader preserves key order and drops unknown channels", async () => {
  const rows = [
    {
      article_id: "9",
      source_id: "tempo",
      content_hash: "t1",
      title: "Tempo IT",
      summary: "s",
      canonical_url: "https://tempo.example/t",
      published_at: "2026-08-12T10:00:00.000Z",
      collected_at: "2026-08-12T10:00:00.000Z",
      effective_timestamp: "2026-08-12T10:00:00.000Z",
    },
  ];
  const reader = createCrawlArticleReader({
    db: { query: async () => ({ rows }) },
  });
  const items = await reader.listArticlesByKeys([
    { sourceId: "detik", contentHash: "missing" },
    { sourceId: "tempo", contentHash: "t1" },
  ]);
  assert.equal(items[0], null);
  assert.equal(items[1].title, "Tempo IT");
  assert.equal(items[1].channel, "tempo");
});
