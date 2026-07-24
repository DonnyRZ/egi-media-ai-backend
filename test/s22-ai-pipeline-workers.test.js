const assert = require("node:assert/strict");
const test = require("node:test");
const { InMemoryJobStore, JobQueueService } = require("../src/queue");
const { AiTaskRegistry, AiPipelineWorker, InMemoryPipelineStateStore, TASK_MODELS } = require("../src/pipeline");

const scope = { tenantId: "tenant-1", companyId: "company-1" };
function setup({ handlers } = {}) { let now = 0; const queue = new JobQueueService({ jobStore: new InMemoryJobStore({ uuid: (() => { let i = 0; return () => `job-${++i}`; })(), now: () => now }), now: () => now, workerId: "worker-1", backoff: () => 0 }); const registry = new AiTaskRegistry({ handlers }); const stateStore = new InMemoryPipelineStateStore({ uuid: () => "pipeline-1", now: () => now }); const worker = new AiPipelineWorker({ queue, registry, stateStore, workerId: "worker-1" }); return { queue, registry, stateStore, worker, advance: (value) => { now = value; } }; }

test("S22 routes each worker to its registered Nano/Mini model and transitions one task at a time", async () => {
  const calls = []; const runtime = setup({ handlers: { T02: async (input) => { calls.push(input); return { nextInput: { article_id: "article-1" } }; }, T03: async (input) => { calls.push(input); return {}; } } });
  const state = runtime.stateStore.create({ ...scope, pipelineId: "pipeline-1", currentTaskId: "T02" }); runtime.worker.enqueueTask({ ...scope, pipelineId: state.pipelineId, taskId: "T02", expectedStateVersion: state.version, input: { article_id: "article-1" }, nextTaskId: "T03" });
  const first = await runtime.worker.processNext({ taskId: "T02" }); assert.equal(first.result.state.currentTaskId, "T03"); assert.equal(first.result.state.status, "queued"); assert.equal(calls[0].model, "nano"); assert.equal(first.result.nextJob.job.jobType, "T03");
  const second = await runtime.worker.processNext({ taskId: "T03" }); assert.equal(second.result.state.status, "succeeded"); assert.equal(calls[1].model, "nano"); assert.equal(TASK_MODELS.T07, "mini");
});

test("S22 rejects invalid transitions and stale state before invoking the task handler", async () => {
  let called = false; const runtime = setup({ handlers: { T02: async () => { called = true; } , T09: async () => ({}) } }); const state = runtime.stateStore.create({ ...scope, pipelineId: "pipeline-1", currentTaskId: "T02" });
  runtime.worker.enqueueTask({ ...scope, pipelineId: state.pipelineId, taskId: "T02", expectedStateVersion: state.version, nextTaskId: "T09" }); const result = await runtime.worker.processNext({ taskId: "T02" }); assert.equal(result.deadLettered, true); assert.equal(called, true); assert.equal(runtime.stateStore.get({ ...scope, pipelineId: state.pipelineId }).status, "dead_letter");
});

test("S22 retries a retryable task and resumes using the updated state version", async () => {
  let attempts = 0; const runtime = setup({ handlers: { T02: async () => { attempts += 1; if (attempts === 1) throw Object.assign(new Error("provider timeout"), { code: "ETIMEDOUT", retryable: true }); return {}; } } }); const state = runtime.stateStore.create({ ...scope, pipelineId: "pipeline-1", currentTaskId: "T02" }); runtime.worker.enqueueTask({ ...scope, pipelineId: state.pipelineId, taskId: "T02", expectedStateVersion: state.version });
  const first = await runtime.worker.processNext({ taskId: "T02" }); assert.equal(first.retried, true); assert.equal(runtime.stateStore.get({ ...scope, pipelineId: state.pipelineId }).status, "retrying"); const second = await runtime.worker.processNext({ taskId: "T02" }); assert.equal(second.job.status, "succeeded"); assert.equal(attempts, 2);
});

test("S22 keeps task registry model routing immutable", () => { const registry = new AiTaskRegistry({ handlers: { T07: async () => ({}) } }); assert.equal(registry.get("T07").model, "mini"); assert.throws(() => registry.register("T99", async () => {}), { code: "AI_TASK_CONFIGURATION_INVALID" }); });
