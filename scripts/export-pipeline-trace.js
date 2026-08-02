"use strict";

require("dotenv").config();

const { Pool } = require("pg");

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const pool = new Pool({ connectionString: process.env.AI_DATABASE_URL, max: 1 });
  try {
    const queueJobs = await loadQueueJobs(pool, args);
    const pipelineIds = unique([
      ...args.pipelineIds,
      ...queueJobs.flatMap((row) => [row.pipeline_id, row.pipeline_id_alt]),
    ]);
    const [pipelines, relevanceDecisions, stageRuns] = await Promise.all([
      loadPipelines(pool, args, pipelineIds),
      loadRelevanceDecisions(pool, args, pipelineIds),
      loadStageRuns(pool, args, pipelineIds),
    ]);

    const trace = {
      generatedAt: new Date().toISOString(),
      mode: "read-only",
      scope: { tenantId: args.tenantId, companyId: args.companyId },
      selectors: {
        pipelineIds: args.pipelineIds,
        traceId: args.traceId,
      },
      coverage: buildCoverage({ queueJobs, pipelines, relevanceDecisions, stageRuns }),
      queueJobs: queueJobs.map(mapQueueJob),
      pipelines: pipelines.map(mapPipeline),
      relevanceDecisions: relevanceDecisions.map(mapRelevance),
      stageRuns: stageRuns.map(mapStageRun),
    };
    console.log(JSON.stringify(trace, null, 2));
  } finally {
    await pool.end();
  }
}

function parseArgs(argv) {
  const result = { tenantId: null, companyId: null, pipelineIds: [], traceId: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--tenant") result.tenantId = value;
    else if (arg === "--company") result.companyId = value;
    else if (arg === "--pipeline-id") result.pipelineIds.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
    else if (arg === "--trace-id") result.traceId = value;
    else throw new Error(`Unknown option: ${arg}`);
    index += 1;
  }
  if (!result.help && (!result.tenantId || !result.companyId || (result.pipelineIds.length < 1 && !result.traceId))) {
    throw new Error("--tenant, --company, and at least one of --pipeline-id or --trace-id are required");
  }
  result.pipelineIds = unique(result.pipelineIds);
  return result;
}

async function loadQueueJobs(pool, args) {
  const { where, values } = scopedWhere(args, { selector: "queue" });
  const result = await pool.query(`
    SELECT id, tenant_id, company_id, job_type, status, attempts, max_attempts,
           last_error_code, last_error_message, dead_lettered_at, created_at, updated_at,
           COALESCE(payload_jsonb->>'pipeline_id', payload_jsonb->>'pipelineId') AS pipeline_id,
           payload_jsonb->>'pipelineId' AS pipeline_id_alt,
           payload_jsonb->>'task_id' AS task_id,
           payload_jsonb->'input'->>'trace_id' AS trace_id
    FROM ai.queue_jobs
    WHERE ${where}
    ORDER BY created_at ASC, id ASC`, values);
  return result.rows;
}

async function loadPipelines(pool, args, pipelineIds) {
  if (pipelineIds.length < 1) return [];
  const { where, values } = scopedWhere(args, { selector: "pipeline", pipelineIds });
  const result = await pool.query(`
    SELECT id, tenant_id, company_id, current_task_id, status, version,
           last_error_code, last_error_message, created_at, updated_at
    FROM ai.pipeline_states
    WHERE ${where}
    ORDER BY created_at ASC, id ASC`, values);
  return result.rows;
}

async function loadRelevanceDecisions(pool, args, pipelineIds) {
  if (pipelineIds.length < 1) return [];
  const { where, values } = scopedWhere(args, { selector: "json-pipeline", pipelineIds, pipelineJsonColumn: "payload_jsonb" });
  const result = await pool.query(`
    SELECT id, tenant_id, company_id, article_snapshot_id, context_id, relevance, confidence, created_at,
           COALESCE(payload_jsonb->>'pipelineId', payload_jsonb->>'pipeline_id', payload_jsonb->'provenance'->>'pipelineId') AS pipeline_id,
           payload_jsonb->>'inputFingerprint' AS input_fingerprint,
           COALESCE(payload_jsonb->>'contextVersion', payload_jsonb->'provenance'->>'contextVersion') AS context_version,
           COALESCE(payload_jsonb->>'identityFingerprint', payload_jsonb->'provenance'->>'identityFingerprint') AS identity_fingerprint,
           COALESCE(payload_jsonb->'provenance'->>'providerRequestId', payload_jsonb->'provenance'->>'requestId') AS provider_request_id,
           payload_jsonb->'provenance'->'usage' AS usage
    FROM ai.article_relevance
    WHERE ${where}
    ORDER BY created_at ASC, id ASC`, values);
  return result.rows;
}

async function loadStageRuns(pool, args, pipelineIds) {
  if (pipelineIds.length < 1) return [];
  const { where, values } = scopedWhere(args, { selector: "stage", pipelineIds, pipelineJsonColumn: "payload_jsonb" });
  const result = await pool.query(`
    SELECT id, pipeline_run_id, tenant_id, company_id, task, input_fingerprint,
           validation_status, model, prompt_id, prompt_version, provider_request_id,
           attempts, started_at, completed_at, created_at,
           COALESCE(pipeline_run_id, payload_jsonb->>'pipelineId', payload_jsonb->>'pipeline_id', payload_jsonb->'provenance'->>'pipelineId') AS pipeline_id,
           COALESCE(payload_jsonb->>'contextVersion', payload_jsonb->'provenance'->>'contextVersion') AS context_version,
           COALESCE(payload_jsonb->>'identityFingerprint', payload_jsonb->'provenance'->>'identityFingerprint') AS identity_fingerprint,
           payload_jsonb->'provenance'->'usage' AS usage
    FROM ai.stage_runs
    WHERE ${where}
    ORDER BY created_at ASC, id ASC`, values);
  return result.rows;
}

function scopedWhere(args, { selector, pipelineIds = [], pipelineJsonColumn = null } = {}) {
  const values = [args.tenantId, args.companyId];
  const clauses = ["tenant_id=$1", "company_id=$2"];
  if (pipelineIds.length > 0) {
    values.push(pipelineIds);
    const parameter = `$${values.length}`;
    if (selector === "pipeline") clauses.push(`id = ANY(${parameter}::text[])`);
    else if (selector === "stage") {
      clauses.push(`(pipeline_run_id = ANY(${parameter}::text[]) OR COALESCE(${pipelineJsonColumn}->>'pipelineId', ${pipelineJsonColumn}->>'pipeline_id', ${pipelineJsonColumn}->'provenance'->>'pipelineId') = ANY(${parameter}::text[]))`);
    } else if (selector === "json-pipeline") {
      clauses.push(`COALESCE(${pipelineJsonColumn}->>'pipelineId', ${pipelineJsonColumn}->>'pipeline_id', ${pipelineJsonColumn}->'provenance'->>'pipelineId') = ANY(${parameter}::text[])`);
    } else {
      clauses.push(`COALESCE(payload_jsonb->>'pipeline_id', payload_jsonb->>'pipelineId') = ANY(${parameter}::text[])`);
    }
  }
  if (args.traceId && selector === "queue") {
    values.push(args.traceId);
    clauses.push(`payload_jsonb->'input'->>'trace_id' = $${values.length}`);
  }
  return { where: clauses.join(" AND "), values };
}

function buildCoverage({ queueJobs, pipelines, relevanceDecisions, stageRuns }) {
  const records = [...relevanceDecisions, ...stageRuns];
  return {
    queueJobs: queueJobs.length,
    pipelines: pipelines.length,
    relevanceDecisions: relevanceDecisions.length,
    stageRuns: stageRuns.length,
    stageTasks: countBy(stageRuns, (row) => row.task),
    withPipelineId: records.filter((row) => row.pipeline_id || row.pipeline_run_id).length,
    withContextVersion: records.filter((row) => row.context_version !== null && row.context_version !== undefined).length,
    withIdentityFingerprint: records.filter((row) => row.identity_fingerprint).length,
    withProviderRequestId: records.filter((row) => row.provider_request_id).length,
    deadLetterJobs: queueJobs.filter((row) => row.status === "dead_letter").length,
    retryingJobs: queueJobs.filter((row) => row.status === "retrying").length,
  };
}

function mapQueueJob(row) {
  return {
    jobId: row.id,
    jobType: row.job_type,
    taskId: row.task_id,
    pipelineId: row.pipeline_id || row.pipeline_id_alt || null,
    traceId: row.trace_id || null,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    errorCode: row.last_error_code,
    errorMessage: row.last_error_message,
    deadLetteredAt: row.dead_lettered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPipeline(row) {
  return {
    pipelineId: row.id,
    currentTaskId: row.current_task_id,
    status: row.status,
    version: row.version,
    errorCode: row.last_error_code,
    errorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRelevance(row) {
  return {
    decisionId: row.id,
    pipelineId: row.pipeline_id,
    articleSnapshotId: row.article_snapshot_id,
    contextVersion: numberOrString(row.context_version),
    identityFingerprint: row.identity_fingerprint || null,
    inputFingerprint: row.input_fingerprint || null,
    relevance: row.relevance,
    confidence: row.confidence === null ? null : Number(row.confidence),
    providerRequestId: row.provider_request_id || null,
    usage: row.usage || null,
    createdAt: row.created_at,
  };
}

function mapStageRun(row) {
  return {
    stageRunId: row.id,
    pipelineId: row.pipeline_id || row.pipeline_run_id || null,
    task: row.task,
    inputFingerprint: row.input_fingerprint || null,
    contextVersion: numberOrString(row.context_version),
    identityFingerprint: row.identity_fingerprint || null,
    validationStatus: row.validation_status,
    model: row.model,
    promptId: row.prompt_id,
    promptVersion: row.prompt_version,
    providerRequestId: row.provider_request_id || null,
    usage: row.usage || null,
    attempts: row.attempts,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function numberOrString(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : value;
}

function countBy(items, keyFn) {
  return items.reduce((result, item) => {
    const key = keyFn(item);
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function usage() {
  return [
    "Read-only AI pipeline trace exporter.",
    "Usage:",
    "  node scripts/export-pipeline-trace.js --tenant <tenant> --company <company> --pipeline-id <id[,id]>",
    "  node scripts/export-pipeline-trace.js --tenant <tenant> --company <company> --trace-id <trace>",
    "",
    "The exporter writes JSON only to stdout and performs SELECT queries; it never mutates the database.",
  ].join("\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = { buildCoverage, mapQueueJob, mapPipeline, mapRelevance, mapStageRun, parseArgs, scopedWhere };
