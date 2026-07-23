const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createSourceRouter } = require("../src/routes/source");

const articleId = "123e4567-e89b-12d3-a456-426614174000";

test("S07 source boundary exposes only published CMS data with locale-aware citation", async () => {
  const calls = [];
  const app = express();
  app.use((req, _res, next) => { req.authContext = { actor: { actorId: "actor-1" } }; next(); });
  app.use(createSourceRouter({ cmsSourceGate: { requirePublishedArticle: async (input) => { calls.push(input); return { sourceArticleId: articleId, requestedLocale: input.locale, contentLocale: "id", canonicalUrl: `https://portal.example/${input.locale}/articles/${articleId}`, article: { id: articleId, title: "Judul", summary: "Ringkasan", content: "Konten", status: "published", publishedAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T01:00:00.000Z" } }; } } }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/source/articles/${articleId}?locale=en`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.citation_url, `https://portal.example/en/articles/${articleId}`);
    assert.deepEqual(calls, [{ articleId, locale: "en" }]);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("S07 source boundary requires authentication and has no CMS mutation route", async () => {
  const app = express();
  app.use(createSourceRouter({ cmsSourceGate: { requirePublishedArticle: async () => { throw new Error("must not call"); } } }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const read = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/source/articles/${articleId}`);
    assert.equal(read.status, 401);
    const mutation = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/source/articles/${articleId}`, { method: "DELETE" });
    assert.equal(mutation.status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
