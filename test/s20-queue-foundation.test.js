const assert = require("node:assert/strict");
const test = require("node:test");
const { InMemoryJobStore, JobQueueService } = require("../src/queue");

const scope = { tenantId: "tenant-1", companyId: "company-1" };
function build() { let now = 0; const store = new InMemoryJobStore({ uuid: (() => { let n = 0; return () => `job-${++n}`; })(), now: () => now }); const queue = new JobQueueService({ jobStore: store, now: () => now, workerId: "worker-1", backoff: ({ attempt }) => attempt * 100 }); return { store, queue, advance: (value) => { now = value; } }; }
function enqueue(queue, overrides = {}) { return queue.enqueue({ ...scope, queueName: "ai-pipeline", jobType: "T02", idempotencyKey: "queue-job-key-0001", payload: { articleId: "article-1" }, maxAttempts: 3, ...overrides }); }

test("S20 persists jobs and returns the same job for the same idempotency key", () => {
  const { queue, store } = build(); const first = enqueue(queue); const second = enqueue(queue);
  assert.equal(first.reused, false); assert.equal(second.reused, true); assert.equal(second.job.jobId, first.job.jobId); assert.equal(store.list({ ...scope }).length, 1);
  assert.throws(() => enqueue(queue, { payload: { articleId: "article-2" } }), { code: "QUEUE_IDEMPOTENCY_CONFLICT" });
});

test("S20 completes a claimed job exactly once", async () => {
  const { queue, store } = build(); enqueue(queue); let handled = 0;
  const result = await queue.processNext({ queueName: "ai-pipeline", handler: async (job) => { handled += 1; return { jobId: job.jobId }; } });
  assert.equal(result.job.status, "succeeded"); assert.deepEqual(result.result, { jobId: "job-1" }); assert.equal(handled, 1); assert.equal(await queue.processNext({ queueName: "ai-pipeline", handler: async () => {} }), null); assert.equal(store.get({ ...scope, jobId: "job-1" }).attempts, 1);
});

test("S20 retries retryable failures with backoff and dead-letters after max attempts", async () => {
  const { queue, store, advance } = build(); enqueue(queue); const failure = Object.assign(new Error("temporary provider failure"), { code: "ETIMEDOUT", retryable: true });
  const first = await queue.processNext({ queueName: "ai-pipeline", handler: async () => { throw failure; } }); assert.equal(first.retried, true); assert.equal(first.delayMs, 100); assert.equal(first.job.status, "retrying");
  advance(100); const second = await queue.processNext({ queueName: "ai-pipeline", handler: async () => { throw failure; } }); assert.equal(second.retried, true); assert.equal(second.delayMs, 200); assert.equal(second.job.attempts, 2);
  advance(300); const third = await queue.processNext({ queueName: "ai-pipeline", handler: async () => { throw failure; } }); assert.equal(third.deadLettered, true); assert.equal(third.job.status, "dead_letter"); assert.equal(third.job.deadLetteredAt, new Date(300).toISOString()); assert.equal(store.list({ ...scope, status: "dead_letter" }).length, 1);
});

test("S20 dead-letters non-retryable failures without another attempt", async () => {
  const { queue } = build(); enqueue(queue); const result = await queue.processNext({ queueName: "ai-pipeline", handler: async () => { throw Object.assign(new Error("schema invalid"), { code: "AI_OUTPUT_SCHEMA_INVALID", retryable: false }); } });
  assert.equal(result.deadLettered, true); assert.equal(result.job.attempts, 1); assert.equal(result.job.lastErrorCode, "AI_OUTPUT_SCHEMA_INVALID");
});
