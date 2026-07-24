const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createIngestRouter } = require("../src/routes/ingest");

test("S21 ingest API enqueues a scoped CMS trigger without accepting article content", async () => {
  const calls = []; const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.authContext = { actor: { actorId: "worker-operator", actorType: "human" }, tenantId: "tenant-1", companyId: "company-1", scopeTrusted: true }; next(); });
  app.use(createIngestRouter({ getIngestRuntime: () => ({ queue: { enqueue: (job) => { calls.push(job); return { reused: false, job: { jobId: "job-ingest-1", status: "queued", updatedAt: "2026-07-23T00:00:00.000Z" } }; } } }) }));
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { const invalid = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/pipeline/ingest`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "ingest-api-key-0001" }, body: JSON.stringify({ mode: "article", locale: "id", article_id: "article-1", content: "must not be accepted" }) }); assert.equal(invalid.status, 400); const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/internal/pipeline/ingest`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "ingest-api-key-0002" }, body: JSON.stringify({ mode: "article", locale: "id", article_id: "article-1" }) }); const body = await response.json(); assert.equal(response.status, 202); assert.equal(body.data.state, "queued"); assert.equal(calls[0].jobType, "cms.article.trigger"); assert.equal(Object.hasOwn(calls[0].payload, "content"), false); } finally { await new Promise((resolve) => server.close(resolve)); }
});
