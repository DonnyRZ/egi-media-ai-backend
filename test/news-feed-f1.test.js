"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHANNELS,
  CRAWL_SOURCE_IDS,
  DEFAULT_CHANNEL_ID,
  getChannel,
  listChannels,
  requireChannel,
} = require("../src/news-feed/channel-registry");
const {
  ARTICLE_SELECT,
  ARTICLE_MIXED_SELECT,
  CrawlSourceUnavailableError,
  InvalidCrawlChannelError,
  createCrawlArticleReader,
  decodeCursor,
  mapCrawlArticle,
} = require("../src/news-feed/crawl-article-reader");
const { assertCrawlReadOnlyQuery } = require("../src/database/crawl-db");
const { DATABASE_OWNERSHIP } = require("../src/database/ownership");

const EXPECTED_CHANNEL_IDS = [
  "viral", "egi_media", "detik", "viva", "suara", "cnn_indonesia", "liputan6",
  "tirto", "tempo", "kumparan", "jawa_pos", "okezone", "sindonews", "idn_times",
  "republika", "media_indonesia", "merdeka", "beritasatu", "tribunnews",
];
const EXPECTED_CRAWL_IDS = EXPECTED_CHANNEL_IDS.slice(2);
const EXPECTED_LABELS = [
  "Viral", "EGI Media", "Detik", "VIVA", "Suara", "CNN Indonesia", "Liputan6",
  "Tirto", "Tempo", "Kumparan", "Jawa Pos", "Okezone", "SINDOnews", "IDN Times",
  "Republika", "Media Indonesia", "Merdeka", "BeritaSatu", "Tribunnews",
];

function crawlRow(overrides = {}) {
  return {
    article_id: "42",
    source_id: "detik",
    canonical_url: "https://canonical.example/article",
    normalized_url: "https://normalized.example/article",
    title: "Judul",
    summary: "Ringkasan",
    thumbnail_url: "https://cdn.example/thumb.jpg",
    published_at: "2026-07-26T10:00:00.000Z",
    collected_at: "2026-07-26T11:00:00.000Z",
    effective_timestamp: "2026-07-26T10:00:00.000Z",
    content_hash: "abc123",
    ...overrides,
  };
}

test("F1 registry locks all channels, order, default, and crawl ids", () => {
  assert.equal(CHANNELS.length, 19);
  assert.deepEqual(listChannels().map((entry) => entry.id), EXPECTED_CHANNEL_IDS);
  assert.deepEqual(listChannels().map((entry) => entry.label), EXPECTED_LABELS);
  assert.deepEqual(CRAWL_SOURCE_IDS, EXPECTED_CRAWL_IDS);
  assert.equal(CRAWL_SOURCE_IDS.length, 17);
  assert.equal(DEFAULT_CHANNEL_ID, "egi_media");
  assert.ok(Object.isFrozen(CHANNELS));
  assert.ok(CHANNELS.every(Object.isFrozen));
});

test("F1 crawl database ownership is isolated and read-only", () => {
  assert.equal(DATABASE_OWNERSHIP.crawl.databaseEnv, "CRAWL_DATABASE_URL");
  assert.equal(DATABASE_OWNERSHIP.crawl.access, "read-only");
  assert.equal(DATABASE_OWNERSHIP.crawl.owner, "egi-media-crawl");
  assert.deepEqual(DATABASE_OWNERSHIP.crawl.tables, ["articles"]);
});

test("F1 registry locks provider, layout, and issue semantics", () => {
  assert.deepEqual(getChannel("viral"), {
    id: "viral", label: "Viral", provider: "viral_x", layout: "text",
    feeds_issues: false, crawl_source_id: null,
  });
  assert.deepEqual(getChannel("egi_media"), {
    id: "egi_media", label: "EGI Media", provider: "cms", layout: "card",
    feeds_issues: true, crawl_source_id: null,
  });
  for (const id of EXPECTED_CRAWL_IDS) {
    const entry = getChannel(id);
    assert.equal(entry.provider, "crawl");
    assert.equal(entry.layout, "card");
    assert.equal(entry.feeds_issues, true);
    assert.equal(entry.crawl_source_id, id);
  }
});

test("F1 registry unknown lookup is explicit", () => {
  assert.equal(getChannel("kompas"), null);
  assert.throws(() => requireChannel("kompas"), {
    code: "UNKNOWN_NEWS_FEED_CHANNEL",
  });
});

test("F1 crawl reader rejects non-crawl and unknown channels", async () => {
  const reader = createCrawlArticleReader({ db: { query: async () => ({ rows: [] }) } });
  for (const channelId of ["viral", "egi_media", "kompas"]) {
    await assert.rejects(
      () => reader.listArticles({ channelId }),
      (error) => error instanceof InvalidCrawlChannelError && error.retryable === false
    );
  }
});

test("F1 crawl SQL is read-only and filters only valid stored rows", () => {
  assert.doesNotThrow(() => assertCrawlReadOnlyQuery(ARTICLE_SELECT));
  assert.match(ARTICLE_SELECT, /FROM articles/i);
  assert.match(ARTICLE_SELECT, /validation_status\s*=\s*'valid'/i);
  assert.doesNotMatch(ARTICLE_SELECT, /\b(INSERT|UPDATE|DELETE|MERGE)\b/i);
  assert.throws(() => assertCrawlReadOnlyQuery("DELETE FROM articles"), /read-only/i);
});

test("F1 mixed crawl SQL stays read-only and filters entitled sources", () => {
  assert.doesNotThrow(() => assertCrawlReadOnlyQuery(ARTICLE_MIXED_SELECT));
  assert.match(ARTICLE_MIXED_SELECT, /source_id = ANY\(\$1::text\[\]\)/i);
  assert.match(ARTICLE_MIXED_SELECT, /validation_status\s*=\s*'valid'/i);
});

test("F1 mixed crawl reader maps each source and preserves cursor paging", async () => {
  const calls = [];
  const rows = [
    crawlRow({ article_id: "44", source_id: "detik", content_hash: "d1", title: "Cloud" }),
    crawlRow({ article_id: "43", source_id: "tempo", content_hash: "t1", title: "Siber" }),
    crawlRow({ article_id: "42", source_id: "detik", content_hash: "d2", title: "Server" }),
  ];
  const reader = createCrawlArticleReader({
    db: { query: async (...args) => { calls.push(args); return { rows }; } },
  });
  const page = await reader.listMixedArticles({
    sourceIds: ["detik", "tempo"],
    limit: 2,
    terms: ["cloud", "siber"],
  });
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].channel, "detik");
  assert.equal(page.items[0].source_label, "Detik");
  assert.equal(page.items[1].channel, "tempo");
  assert.ok(page.next_cursor);
  assert.deepEqual(calls[0][1][0], ["detik", "tempo"]);
  assert.deepEqual(calls[0][1][4], ["%cloud%", "%siber%"]);
});

test("F1 crawl reader uses deterministic keyset ordering and exclusive cursor", async () => {
  const calls = [];
  const rows = [
    crawlRow({ article_id: "44", effective_timestamp: "2026-07-26T12:00:00.000Z" }),
    crawlRow({ article_id: "43", effective_timestamp: "2026-07-26T12:00:00.000Z" }),
    crawlRow({ article_id: "42", effective_timestamp: "2026-07-26T11:00:00.000Z" }),
  ];
  const reader = createCrawlArticleReader({
    db: { query: async (...args) => { calls.push(args); return { rows }; } },
  });

  const page = await reader.listArticles({ channelId: "detik", limit: 2 });
  assert.equal(page.items.length, 2);
  assert.ok(page.next_cursor);
  assert.deepEqual(decodeCursor(page.next_cursor), {
    effectiveTimestamp: "2026-07-26T12:00:00.000Z",
    articleId: "43",
  });
  assert.match(calls[0][0], /COALESCE\(published_at, collected_at\) DESC,\s*article_id DESC/i);
  assert.match(calls[0][0], /\(COALESCE\(published_at, collected_at\), article_id\)\s*</i);
  assert.deepEqual(calls[0][1], ["detik", null, null, 3]);

  await reader.listArticles({ channelId: "detik", limit: 2, cursor: page.next_cursor });
  assert.deepEqual(calls[1][1], ["detik", "2026-07-26T12:00:00.000Z", "43", 3]);
});

test("F1 crawl mapper preserves thumbnail key and canonical URL fallback", () => {
  const channel = getChannel("detik");
  const present = mapCrawlArticle(crawlRow(), channel);
  assert.equal(present.thumbnail_url, "https://cdn.example/thumb.jpg");
  assert.equal(present.source_url, "https://canonical.example/article");
  assert.equal(present.issue_source_id, "crawl:detik:abc123");

  const absent = mapCrawlArticle(crawlRow({
    canonical_url: "",
    normalized_url: "https://normalized.example/fallback",
    thumbnail_url: null,
    published_at: null,
  }), channel);
  assert.ok(Object.hasOwn(absent, "thumbnail_url"));
  assert.equal(absent.thumbnail_url, null);
  assert.equal(absent.source_url, "https://normalized.example/fallback");
  assert.equal(absent.published_at, null);
});

test("F1 crawl unavailable and timeout failures are structured and retryable", async () => {
  const unavailable = createCrawlArticleReader({
    db: { query: async () => { throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }); } },
  });
  await assert.rejects(
    () => unavailable.listArticles({ channelId: "detik" }),
    (error) => error instanceof CrawlSourceUnavailableError
      && error.code === "CRAWL_SOURCE_UNAVAILABLE"
      && error.retryable === true
  );

  const timedOut = createCrawlArticleReader({
    db: { query: () => new Promise(() => {}) },
    queryTimeoutMs: 10,
  });
  await assert.rejects(
    () => timedOut.listArticles({ channelId: "detik" }),
    (error) => error instanceof CrawlSourceUnavailableError
      && error.retryable === true
      && error.cause?.code === "CRAWL_QUERY_TIMEOUT"
  );
});
