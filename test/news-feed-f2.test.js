'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { listChannels, DEFAULT_CHANNEL_ID } = require('../src/news-feed/channel-registry');
const {
  encodeCursor,
  CrawlSourceUnavailableError,
} = require('../src/news-feed/crawl-article-reader');
const {
  createNewsFeedService,
  mapCmsArticle,
  normalizeLimit,
  VIRAL_COMING_SOON_MESSAGE,
} = require('../src/news-feed/news-feed.service');
const { createNewsFeedRouter } = require('../src/routes/news-feed');
const { CmsSourceError } = require('../src/cms/cms-source.errors');

const EXPECTED_CHANNEL_IDS = [
  'viral', 'egi_media', 'detik', 'viva', 'suara', 'cnn_indonesia', 'liputan6',
  'tirto', 'tempo', 'kumparan', 'jawa_pos', 'okezone', 'sindonews', 'idn_times',
  'republika', 'media_indonesia', 'merdeka', 'beritasatu', 'tribunnews',
];

const auth = { tenantId: 'tenant-1', companyId: 'company-1' };

function listen({ service, withAuth = true } = {}) {
  const app = express();
  if (withAuth) {
    app.use((req, _res, next) => {
      req.authContext = {
        actor: { actorId: 'actor-1' },
        ...auth,
        scopeTrusted: true,
      };
      next();
    });
  }
  app.use(createNewsFeedRouter({
    getNewsFeedService: () => service,
  }));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function crawlItem(overrides = {}) {
  return {
    id: 'crawl:detik:hash-1',
    channel: 'detik',
    provider: 'crawl',
    layout: 'card',
    title: 'Detik judul',
    summary: 'Ringkasan',
    published_at: '2026-07-26T10:00:00.000Z',
    source_url: 'https://canonical.example/article',
    thumbnail_url: null,
    crawl_source_id: 'detik',
    issue_source_id: 'crawl:detik:hash-1',
    ...overrides,
  };
}

test('F2 registry still exposes all 19 channels in locked order', () => {
  assert.equal(listChannels().length, 19);
  assert.deepEqual(listChannels().map((entry) => entry.id), EXPECTED_CHANNEL_IDS);
  assert.equal(DEFAULT_CHANNEL_ID, 'egi_media');
});

test('F2 unknown channel returns structured 400', async () => {
  const service = createNewsFeedService({
    crawlArticleReader: { listArticles: async () => ({ items: [], next_cursor: null }) },
    cmsArticleClient: { listPublishedArticles: async () => ({ items: [], nextCursor: null }) },
    portalBaseUrl: 'http://portal.example',
  });
  const server = await listen({ service });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed?channel=kompas`);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'UNKNOWN_NEWS_FEED_CHANNEL');
    assert.ok(body.error.message);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('F2 crawl channel returns items with thumbnail_url key and pass-through ordering', async () => {
  const calls = [];
  const items = [
    crawlItem({ id: 'crawl:detik:a', title: 'First', thumbnail_url: 'https://cdn.example/a.jpg' }),
    crawlItem({ id: 'crawl:detik:b', title: 'Second', thumbnail_url: null }),
  ];
  const service = createNewsFeedService({
    crawlArticleReader: {
      listArticles: async (request) => {
        calls.push(request);
        return { items, next_cursor: 'cursor-next' };
      },
    },
    cmsArticleClient: { listPublishedArticles: async () => ({ items: [], nextCursor: null }) },
    portalBaseUrl: 'http://portal.example',
  });
  const server = await listen({ service });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed?channel=detik&limit=2`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.channel, 'detik');
    assert.equal(body.data.label, 'Detik');
    assert.equal(body.data.layout, 'card');
    assert.equal(body.data.provider, 'crawl');
    assert.equal(body.data.next_cursor, 'cursor-next');
    assert.equal(body.data.items.length, 2);
    assert.ok(Object.hasOwn(body.data.items[0], 'thumbnail_url'));
    assert.ok(Object.hasOwn(body.data.items[1], 'thumbnail_url'));
    assert.equal(body.data.items[0].thumbnail_url, 'https://cdn.example/a.jpg');
    assert.equal(body.data.items[1].thumbnail_url, null);
    assert.deepEqual(body.data.items.map((item) => item.title), ['First', 'Second']);
    assert.deepEqual(calls[0], { channelId: 'detik', cursor: null, limit: 2 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('F2 egi_media maps CMS featured_image to thumbnail_url', async () => {
  const service = createNewsFeedService({
    crawlArticleReader: { listArticles: async () => ({ items: [], next_cursor: null }) },
    cmsArticleClient: {
      listPublishedArticles: async () => ({
        items: [{
          id: '550e8400-e29b-41d4-a716-446655440000',
          title: 'CMS judul',
          summary: 'CMS ringkasan',
          featured_image: 'https://cdn.example/cms.jpg',
          published_at: '2026-07-26T09:00:00.000Z',
          locale: 'id',
        }],
        nextCursor: 'cms-cursor',
      }),
    },
    portalBaseUrl: 'http://portal.example',
  });
  const server = await listen({ service });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.channel, 'egi_media');
    assert.equal(body.data.layout, 'card');
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.items[0].thumbnail_url, 'https://cdn.example/cms.jpg');
    assert.equal(body.data.items[0].id, 'cms:550e8400-e29b-41d4-a716-446655440000');
    assert.equal(body.data.items[0].issue_source_id, 'cms:550e8400-e29b-41d4-a716-446655440000');
    assert.equal(
      body.data.items[0].source_url,
      'http://portal.example/id/articles/550e8400-e29b-41d4-a716-446655440000'
    );
    assert.equal(body.data.next_cursor, 'cms-cursor');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('F2 viral returns empty coming-soon payload with text layout', async () => {
  let crawlCalled = false;
  let cmsCalled = false;
  const service = createNewsFeedService({
    crawlArticleReader: {
      listArticles: async () => {
        crawlCalled = true;
        return { items: [], next_cursor: null };
      },
    },
    cmsArticleClient: {
      listPublishedArticles: async () => {
        cmsCalled = true;
        return { items: [], nextCursor: null };
      },
    },
    portalBaseUrl: 'http://portal.example',
  });
  const server = await listen({ service });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed?channel=viral`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.channel, 'viral');
    assert.equal(body.data.layout, 'text');
    assert.equal(body.data.provider, 'viral_x');
    assert.deepEqual(body.data.items, []);
    assert.equal(body.data.next_cursor, null);
    assert.equal(body.data.availability, 'coming_soon');
    assert.equal(body.data.message, VIRAL_COMING_SOON_MESSAGE);
    assert.equal(crawlCalled, false);
    assert.equal(cmsCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('F2 limit clamps to max 100 and cursor round-trips for crawl', async () => {
  const calls = [];
  const opaque = encodeCursor({
    effectiveTimestamp: '2026-07-26T10:00:00.000Z',
    articleId: '99',
  });
  const service = createNewsFeedService({
    crawlArticleReader: {
      listArticles: async (request) => {
        calls.push(request);
        return { items: [crawlItem()], next_cursor: opaque };
      },
    },
    cmsArticleClient: { listPublishedArticles: async () => ({ items: [], nextCursor: null }) },
    portalBaseUrl: 'http://portal.example',
  });
  const server = await listen({ service });
  try {
    const over = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed?channel=detik&limit=500`);
    const overBody = await over.json();
    assert.equal(over.status, 200);
    assert.equal(calls[0].limit, 100);

    const page = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/news-feed?channel=detik&cursor=${encodeURIComponent(opaque)}`
    );
    const pageBody = await page.json();
    assert.equal(page.status, 200);
    assert.equal(calls[1].cursor, opaque);
    assert.equal(pageBody.data.next_cursor, opaque);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('F2 rejects unauthenticated callers and cross-company scope', async () => {
  const service = createNewsFeedService({
    crawlArticleReader: { listArticles: async () => ({ items: [], next_cursor: null }) },
    cmsArticleClient: { listPublishedArticles: async () => ({ items: [], nextCursor: null }) },
    portalBaseUrl: 'http://portal.example',
  });

  const unauthServer = await listen({ service, withAuth: false });
  try {
    const response = await fetch(`http://127.0.0.1:${unauthServer.address().port}/api/v1/news-feed`);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  } finally {
    await new Promise((resolve) => unauthServer.close(resolve));
  }

  const server = await listen({ service });
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/news-feed?company_id=company-2`
    );
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'SCOPE_CONTEXT_UNTRUSTED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('F2 success and error envelopes match existing API shape', async () => {
  const service = createNewsFeedService({
    crawlArticleReader: { listArticles: async () => ({ items: [], next_cursor: null }) },
    cmsArticleClient: { listPublishedArticles: async () => ({ items: [], nextCursor: null }) },
    portalBaseUrl: 'http://portal.example',
  });
  const server = await listen({ service });
  try {
    const ok = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed?channel=viral`);
    const okBody = await ok.json();
    assert.equal(okBody.success, true);
    assert.ok(okBody.data);
    assert.ok(okBody.meta);
    assert.ok('request_id' in okBody.meta);
    assert.ok('correlation_id' in okBody.meta);

    const bad = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed?channel=unknown`);
    const badBody = await bad.json();
    assert.equal(badBody.success, false);
    assert.equal(typeof badBody.error.code, 'string');
    assert.equal(typeof badBody.error.message, 'string');
    assert.ok(badBody.meta);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('F2 CMS mapper keeps thumbnail_url key when featured_image is absent', () => {
  const channel = listChannels().find((entry) => entry.id === 'egi_media');
  const mapped = mapCmsArticle(
    { id: '550e8400-e29b-41d4-a716-446655440000', title: 'Tanpa gambar', published_at: '2026-07-26T09:00:00.000Z' },
    channel,
    'http://portal.example',
    'id'
  );
  assert.ok(Object.hasOwn(mapped, 'thumbnail_url'));
  assert.equal(mapped.thumbnail_url, null);
  assert.equal(normalizeLimit(undefined), 20);
  assert.equal(normalizeLimit(150), 100);
});

test('F2 CMS mapper ignores invalid article.locale and falls back to feed locale', () => {
  const channel = listChannels().find((entry) => entry.id === 'egi_media');
  const mapped = mapCmsArticle(
    {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Locale jelek',
      published_at: '2026-07-26T09:00:00.000Z',
      locale: 1,
    },
    channel,
    'http://portal.example',
    'id'
  );
  assert.equal(mapped.source_url, 'http://portal.example/id/articles/550e8400-e29b-41d4-a716-446655440000');
});

test('F2 crawl and CMS unavailable errors are structured and retryable', async () => {
  const service = createNewsFeedService({
    crawlArticleReader: {
      listArticles: async () => {
        throw new CrawlSourceUnavailableError();
      },
    },
    cmsArticleClient: {
      listPublishedArticles: async () => {
        throw new CmsSourceError('CMS article polling failed', {
          code: 'CMS_SOURCE_UNAVAILABLE',
          retryable: true,
        });
      },
    },
    portalBaseUrl: 'http://portal.example',
  });
  const server = await listen({ service });
  try {
    const crawl = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed?channel=detik`);
    const crawlBody = await crawl.json();
    assert.equal(crawl.status, 503);
    assert.equal(crawlBody.success, false);
    assert.equal(crawlBody.error.code, 'CRAWL_SOURCE_UNAVAILABLE');
    assert.equal(crawlBody.error.message, 'Crawl article source is temporarily unavailable');
    assert.equal(crawlBody.meta.retryable, true);
    assert.equal(JSON.stringify(crawlBody).includes('postgresql'), false);

    const cms = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed?channel=egi_media`);
    const cmsBody = await cms.json();
    assert.equal(cms.status, 503);
    assert.equal(cmsBody.error.code, 'CMS_SOURCE_UNAVAILABLE');
    assert.equal(cmsBody.meta.retryable, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('F2 mixed view lists entitled crawl sources without a channel tab', async () => {
  const calls = [];
  const service = createNewsFeedService({
    crawlArticleReader: {
      listArticles: async () => ({ items: [], next_cursor: null }),
      listMixedArticles: async (request) => {
        calls.push(request);
        return {
          items: [
            crawlItem({ id: 'crawl:detik:a', title: 'Cloud', source_label: 'Detik' }),
            crawlItem({
              id: 'crawl:tempo:b',
              channel: 'tempo',
              crawl_source_id: 'tempo',
              title: 'Siber',
              source_label: 'Tempo',
            }),
          ],
          next_cursor: null,
        };
      },
    },
    cmsArticleClient: { listPublishedArticles: async () => ({ items: [], nextCursor: null }) },
    portalBaseUrl: 'http://portal.example',
  });
  const server = await listen({ service });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/news-feed?view=mixed&limit=20`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.channel, 'mixed');
    assert.equal(body.data.label, 'News Feed');
    assert.equal(body.data.items.length, 2);
    assert.equal(body.data.items[0].title, 'Cloud');
    assert.equal(body.data.items[1].title, 'Siber');
    assert.ok(Array.isArray(calls[0].sourceIds));
    assert.ok(calls[0].sourceIds.includes('detik'));
    assert.ok(calls[0].terms.includes('siber'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
