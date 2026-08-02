const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCoverage,
  parseArgs,
  scopedWhere,
} = require("../scripts/export-pipeline-trace");

test("pipeline trace exporter parses bounded selectors", () => {
  assert.deepEqual(parseArgs([
    "--tenant", "tenant-1",
    "--company", "company-1",
    "--pipeline-id", "pipeline-1,pipeline-2,pipeline-1",
  ]), {
    tenantId: "tenant-1",
    companyId: "company-1",
    pipelineIds: ["pipeline-1", "pipeline-2"],
    traceId: null,
    help: false,
  });
  assert.deepEqual(parseArgs([
    "--tenant", "tenant-1",
    "--company", "company-1",
    "--trace-id", "trace-1",
  ]), {
    tenantId: "tenant-1",
    companyId: "company-1",
    pipelineIds: [],
    traceId: "trace-1",
    help: false,
  });
});

test("pipeline trace exporter scopes each table by its real schema", () => {
  const args = { tenantId: "tenant-1", companyId: "company-1", traceId: null };
  const pipeline = scopedWhere(args, { selector: "pipeline", pipelineIds: ["pipeline-1"] });
  assert.match(pipeline.where, /id = ANY\(\$3::text\[\]\)/);
  assert.doesNotMatch(pipeline.where, /payload_jsonb|pipeline_run_id/);

  const relevance = scopedWhere(args, {
    selector: "json-pipeline",
    pipelineIds: ["pipeline-1"],
    pipelineJsonColumn: "payload_jsonb",
  });
  assert.match(relevance.where, /payload_jsonb/);
  assert.doesNotMatch(relevance.where, /pipeline_run_id/);

  const stage = scopedWhere(args, {
    selector: "stage",
    pipelineIds: ["pipeline-1"],
    pipelineJsonColumn: "payload_jsonb",
  });
  assert.match(stage.where, /pipeline_run_id/);
});

test("pipeline trace exporter reports bounded coverage counts", () => {
  assert.deepEqual(buildCoverage({
    queueJobs: [
      { status: "dead_letter" },
      { status: "retrying" },
    ],
    pipelines: [{}],
    relevanceDecisions: [
      { pipeline_id: "pipeline-1", context_version: 2, identity_fingerprint: "identity-1", provider_request_id: "request-1" },
    ],
    stageRuns: [
      { task: "T02", pipeline_id: "pipeline-1", context_version: 2, identity_fingerprint: "identity-1", provider_request_id: "request-2" },
      { task: "T07", pipeline_id: null, context_version: null, identity_fingerprint: null, provider_request_id: null },
    ],
  }), {
    queueJobs: 2,
    pipelines: 1,
    relevanceDecisions: 1,
    stageRuns: 2,
    stageTasks: { T02: 1, T07: 1 },
    withPipelineId: 2,
    withContextVersion: 2,
    withIdentityFingerprint: 2,
    withProviderRequestId: 2,
    deadLetterJobs: 1,
    retryingJobs: 1,
  });
});
