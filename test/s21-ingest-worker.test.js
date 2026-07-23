const assert = require("node:assert/strict");
const test = require("node:test");
const { IngestWorker, InMemorySourceSnapshotStore, InMemoryWatermarkStore } = require("../src/ingest");

const scope = { tenantId: "tenant-1", companyId: "company-1" };
function source(articleId, updatedAt) { return { sourceArticleId: articleId, canonicalUrl: `https://portal.example/id/articles/${articleId}`, article: { id: articleId, title: `Article ${articleId}`, summary: "Summary", content: "Body", status: "published", publishedAt: "2026-07-23T00:00:00.000Z", updatedAt } }; }

test("S21 polls CMS from watermark, snapshots published sources, and enqueues only relevance stage", async () => {
  let listRequest; const jobs = []; const watermarkStore = new InMemoryWatermarkStore({ now: () => 0 }); const snapshotStore = new InMemorySourceSnapshotStore({ uuid: (() => { let i = 0; return () => `snapshot-${++i}`; })(), now: () => 0 });
  const worker = new IngestWorker({ sourceGate: { requirePublishedArticle: async ({ articleId }) => source(articleId, articleId === "article-1" ? "2026-07-23T01:00:00.000Z" : "2026-07-23T02:00:00.000Z") }, articleListClient: { listPublishedArticles: async (request) => { listRequest = request; return { items: [{ id: "article-1" }, { id: "article-2" }], nextCursor: "cursor-2" }; } }, snapshotStore, watermarkStore, enqueueStageJob: async (job) => { jobs.push(job); return { jobId: `stage-${jobs.length}` }; }, now: () => Date.parse("2026-07-23T03:00:00.000Z") });
  const result = await worker.poll({ ...scope, locale: "id", limit: 20 });
  assert.equal(listRequest.updatedSince, null); assert.equal(listRequest.cursor, null); assert.equal(result.count, 2); assert.equal(snapshotStore.list().length, 2); assert.equal(jobs.length, 2); assert.ok(jobs.every((job) => job.stage === "relevance")); assert.equal(result.watermark.watermark, "2026-07-23T02:00:00.000Z"); assert.equal(result.watermark.cursor, "cursor-2");
  await worker.poll({ ...scope, locale: "id", limit: 20 }); assert.equal(listRequest.updatedSince, "2026-07-23T02:00:00.000Z"); assert.equal(listRequest.cursor, "cursor-2"); assert.equal(snapshotStore.list().length, 2);
});

test("S21 article trigger fail-closes unpublished sources and does not enqueue downstream stages", async () => {
  let jobs = 0; const worker = new IngestWorker({ sourceGate: { requirePublishedArticle: async () => { throw Object.assign(new Error("not published"), { code: "CMS_SOURCE_NOT_PUBLISHED" }); } }, articleListClient: { listPublishedArticles: async () => ({ items: [] }) }, snapshotStore: new InMemorySourceSnapshotStore(), watermarkStore: new InMemoryWatermarkStore(), enqueueStageJob: async () => { jobs += 1; } });
  await assert.rejects(worker.triggerArticle({ ...scope, articleId: "article-1", locale: "id" }), { code: "CMS_SOURCE_NOT_PUBLISHED" }); assert.equal(jobs, 0);
});

test("S21 trigger creates one source snapshot and one relevance dispatch", async () => {
  const jobs = []; const worker = new IngestWorker({ sourceGate: { requirePublishedArticle: async () => source("article-1", "2026-07-23T01:00:00.000Z") }, articleListClient: { listPublishedArticles: async () => ({ items: [] }) }, snapshotStore: new InMemorySourceSnapshotStore({ uuid: () => "snapshot-1" }), watermarkStore: new InMemoryWatermarkStore(), enqueueStageJob: async (job) => { jobs.push(job); return { jobId: "stage-1" }; } });
  const result = await worker.triggerArticle({ ...scope, articleId: "article-1", locale: "id" }); assert.equal(result.snapshot.snapshotId, "snapshot-1"); assert.equal(jobs.length, 1); assert.equal(jobs[0].stage, "relevance"); assert.equal(jobs[0].sourceSnapshotId, "snapshot-1");
});
