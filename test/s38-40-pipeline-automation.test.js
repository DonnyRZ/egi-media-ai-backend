const test = require("node:test");
const assert = require("node:assert/strict");
const { PipelineStageDispatcher } = require("../src/automation/pipeline-stage-dispatcher");
const { InMemoryPipelineCompanyStore } = require("../src/automation/company-scope");
const { InMemoryPipelineStateStore } = require("../src/pipeline");

test("S38/S40 dispatches one source snapshot into independently scoped company pipelines", async () => {
  const jobs = [];
  const dispatcher = new PipelineStageDispatcher({
    companyStore: new InMemoryPipelineCompanyStore({ companies: [
      { tenantId: "tenant-a", companyId: "company-a", hasEffectiveContext: true },
      { tenantId: "tenant-a", companyId: "company-b", hasEffectiveContext: true },
      { tenantId: "tenant-b", companyId: "company-x", hasEffectiveContext: false },
    ] }),
    pipelineStateStore: new InMemoryPipelineStateStore({ uuid: (() => { let i = 0; return () => `pipeline-${++i}`; })() }),
    pipelineWorker: { enqueueTask: async (job) => { jobs.push(job); return { job: { jobId: `job-${jobs.length}` } }; } },
    logger: { info() {} },
  });
  const result = await dispatcher.dispatch({ sourceSnapshotId: "snapshot-1", sourceArticleId: "article-1", locale: "id" });
  assert.equal(result.count, 2);
  assert.deepEqual(jobs.map((job) => [job.tenantId, job.companyId]), [["tenant-a", "company-a"], ["tenant-a", "company-b"]]);
  assert.ok(jobs.every((job) => job.taskId === "T02" && job.input.source_snapshot_id === "snapshot-1"));
});
