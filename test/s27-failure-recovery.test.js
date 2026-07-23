const assert = require("node:assert/strict");
const test = require("node:test");

const { AiTaskKernel } = require("../src/ai/kernel/ai-task-kernel");
const { T02_OUTPUT_SCHEMA } = require("../src/ai/tasks/t02-relevance-class/schema");
const { CmsArticleClient } = require("../src/cms/cms-article.client");
const { withTransaction } = require("../src/database/transaction");
const { checkDatabaseHealth } = require("../src/database/health");
const { InMemoryJobStore, JobQueueService } = require("../src/queue");

function providerFailure({ status, name } = {}) {
  return Object.assign(new Error("simulated provider failure"), { status, name });
}

test("S27 normalizes OpenAI timeout, 429, and 5xx as retryable failures", async () => {
  for (const [label, error, code] of [
    ["timeout", providerFailure({ name: "APIConnectionTimeoutError" }), "AI_PROVIDER_TIMEOUT"],
    ["rate limit", providerFailure({ status: 429 }), "AI_PROVIDER_RATE_LIMITED"],
    ["server error", providerFailure({ status: 503 }), "AI_PROVIDER_UNAVAILABLE"],
  ]) {
    const kernel = new AiTaskKernel({
      openaiClient: { responses: { create: async () => { throw error; } } },
      openaiConfig: { nanoModel: "nano-s27", miniModel: "mini-s27" },
      defaultTimeoutMs: 100,
    });
    await assert.rejects(kernel.execute({ model: "nano", input: "s27", outputSchema: T02_OUTPUT_SCHEMA }), (actual) => {
      assert.equal(actual.code, code, label);
      assert.equal(actual.retryable, true, label);
      return true;
    });
  }
});

test("S27 CMS errors preserve timeout/retry semantics and fail closed on malformed responses", async () => {
  const rejected = new CmsArticleClient({ baseUrl: "http://cms.example", timeoutMs: 100, fetchFn: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(rejected.getArticleById({ articleId: "article-s27", locale: "id" }), { code: "CMS_SOURCE_REJECTED", retryable: true });

  const timedOut = new CmsArticleClient({ baseUrl: "http://cms.example", timeoutMs: 100, fetchFn: async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); } });
  await assert.rejects(timedOut.getArticleById({ articleId: "article-s27", locale: "id" }), { code: "CMS_SOURCE_TIMEOUT", retryable: true });

  const malformed = new CmsArticleClient({ baseUrl: "http://cms.example", timeoutMs: 100, fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: "not-an-article" }) }) });
  assert.equal(await malformed.getArticleById({ articleId: "article-s27", locale: "id" }), null);
});

test("S27 database failure rolls back and health fails closed", async () => {
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql); if (sql === "SELECT unavailable") throw Object.assign(new Error("database down"), { code: "ECONNRESET" }); }, release: () => calls.push("RELEASE") };
  await assert.rejects(withTransaction({ connect: async () => client }, (tx) => tx.query("SELECT unavailable")), { code: "ECONNRESET" });
  assert.deepEqual(calls, ["BEGIN ISOLATION LEVEL READ COMMITTED", "SELECT unavailable", "ROLLBACK", "RELEASE"]);
  assert.deepEqual(await checkDatabaseHealth({ source: { healthCheck: async () => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }); } }, ai: { healthCheck: async () => true } }), { healthy: false, checks: { source_database: "failed", ai_database: "ok" } });
});

test("S27 queue retries a transient failure and recovers without duplicating the job", async () => {
  let now = 0;
  let handled = 0;
  const store = new InMemoryJobStore({ uuid: () => "job-s27", now: () => now });
  const queue = new JobQueueService({ jobStore: store, now: () => now, workerId: "worker-s27", backoff: () => 100 });
  const input = { tenantId: "tenant-s27", companyId: "company-s27", queueName: "ai", jobType: "T02", idempotencyKey: "s27-duplicate-job-key", payload: { articleId: "article-s27" }, maxAttempts: 3 };
  const first = queue.enqueue(input);
  const duplicate = queue.enqueue(input);
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.job.jobId, first.job.jobId);

  const transient = Object.assign(new Error("temporary upstream failure"), { code: "AI_PROVIDER_TIMEOUT", retryable: true });
  const failed = await queue.processNext({ queueName: "ai", handler: async () => { handled += 1; throw transient; } });
  assert.equal(failed.retried, true);
  assert.equal(failed.job.status, "retrying");
  now = 100;
  const recovered = await queue.processNext({ queueName: "ai", handler: async (job) => { handled += 1; return { jobId: job.jobId }; } });
  assert.equal(recovered.job.status, "succeeded");
  assert.deepEqual(recovered.result, { jobId: "job-s27" });
  assert.equal(handled, 2);
  assert.equal(store.list({ tenantId: "tenant-s27", companyId: "company-s27" }).length, 1);
});
