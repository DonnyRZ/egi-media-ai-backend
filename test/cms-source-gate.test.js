const assert = require("node:assert/strict");
const test = require("node:test");

const { CmsArticleClient } = require("../src/cms/cms-article.client");
const { CmsSourceGate } = require("../src/cms/cms-source-gate");

const articleId = "123e4567-e89b-12d3-a456-426614174000";

function publishedArticle(overrides = {}) {
  return {
    id: articleId,
    title: "Example article",
    summary: "Example summary",
    content: "Example content",
    status: "published",
    published_at: "2026-07-22T10:00:00.000Z",
    updated_at: "2026-07-22T11:00:00.000Z",
    locale: "id",
    ...overrides,
  };
}

test("CMS article client uses only read-only GET by ID with requested locale", async () => {
  let requestedUrl;
  let requestedOptions;
  const client = new CmsArticleClient({
    baseUrl: "http://cms.local:5002",
    timeoutMs: 1000,
    fetchFn: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return new Response(JSON.stringify({ success: true, data: publishedArticle() }), { status: 200 });
    },
  });

  const article = await client.getArticleById({ articleId, locale: "en" });

  assert.equal(requestedOptions.method, "GET");
  assert.equal(requestedOptions.body, undefined);
  assert.equal(requestedUrl.toString(), `http://cms.local:5002/api/v1/articles/${articleId}?lang=en`);
  assert.equal(article.id, articleId);
});

test("source gate accepts a published article and creates a locale-aware canonical citation", async () => {
  const calls = [];
  const gate = new CmsSourceGate({
    cmsArticleClient: { getArticleById: async (request) => { calls.push(request); return publishedArticle({ locale: "id" }); } },
    portalBaseUrl: "https://portal.example/base/",
  });

  const source = await gate.requirePublishedArticle({ articleId, locale: "en" });

  assert.deepEqual(calls, [{ articleId, locale: "en" }]);
  assert.equal(source.requestedLocale, "en");
  assert.equal(source.contentLocale, "id");
  assert.equal(source.canonicalUrl, `https://portal.example/base/en/articles/${articleId}`);
  assert.equal(source.article.status, "published");
});

test("source gate rejects missing, unpublished, deleted, and malformed articles", async (t) => {
  const cases = [
    { name: "not found", article: null, code: "CMS_SOURCE_NOT_FOUND" },
    { name: "draft", article: publishedArticle({ status: "draft" }), code: "CMS_SOURCE_NOT_PUBLISHED" },
    { name: "deleted", article: publishedArticle({ deleted_at: "2026-07-22T12:00:00.000Z" }), code: "CMS_SOURCE_DELETED" },
    { name: "missing publication date", article: publishedArticle({ published_at: null }), code: "CMS_SOURCE_MALFORMED_ARTICLE" },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const gate = new CmsSourceGate({
        cmsArticleClient: { getArticleById: async () => item.article },
        portalBaseUrl: "https://portal.example",
      });
      await assert.rejects(gate.requirePublishedArticle({ articleId, locale: "id" }), { code: item.code });
    });
  }
});

test("source gate rejects invalid article IDs and locales before calling CMS", async () => {
  let called = false;
  const gate = new CmsSourceGate({
    cmsArticleClient: { getArticleById: async () => { called = true; return publishedArticle(); } },
    portalBaseUrl: "https://portal.example",
  });

  await assert.rejects(gate.requirePublishedArticle({ articleId: "not-a-uuid", locale: "id" }), {
    code: "CMS_SOURCE_ARTICLE_ID_INVALID",
  });
  await assert.rejects(gate.requirePublishedArticle({ articleId, locale: "fr" }), {
    code: "CMS_SOURCE_LOCALE_INVALID",
  });
  assert.equal(called, false);
});
