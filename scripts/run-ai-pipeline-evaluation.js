"use strict";

require("dotenv").config();

const { randomUUID } = require("crypto");
const { Pool } = require("pg");
const { formatCrawlIssueSourceId } = require("../src/cms/issue-source-id");

const INPUT_PRICE = 1 / 1_000_000;
const CACHED_INPUT_PRICE = 0.10 / 1_000_000;
const OUTPUT_PRICE = 6 / 1_000_000;
const SOFT_CAP_USD = 9.5;
const MAX_CAP_USD = 10;
const TASK_QUEUE = "ai-task-T02";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  const runId = args.runId || `eval-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const tenantId = `eval-tenant-${runId}`;
  const companyId = `eval-company-${runId}`;
  const ai = new Pool({ connectionString: process.env.AI_DATABASE_URL, max: 2 });
  const crawl = new Pool({ connectionString: process.env.CRAWL_DATABASE_URL, max: 2 });

  try {
    if (args.cleanupTenant) {
      await cleanupTenant(ai, args.cleanupTenant);
      console.log(JSON.stringify({ event: "evaluation_scope_cleaned", tenantId: args.cleanupTenant }));
      return;
    }
    const source = await loadSourceScope(ai, args.sourceCompany);
    const articles = await selectArticles(crawl, args.limit);
    if (articles.length < args.limit) throw new Error(`Only ${articles.length} eligible crawl articles found; need ${args.limit}`);

    await createEvaluationScope(ai, { tenantId, companyId, runId, source });
    console.log(JSON.stringify({ event: "evaluation_scope_created", runId, tenantId, companyId, sourceCompanyId: source.companyId, contextVersion: source.contextVersion, articleCount: articles.length }));

    const batches = chunk(articles, args.batchSize);
    let processed = 0;
    for (const batch of batches) {
      const before = await readUsage(ai, tenantId, companyId);
      const estimate = estimateNextBatchUsd(before, batch.length, args.estimatedUsdPerArticle);
      if (before.costUsd + estimate >= SOFT_CAP_USD || before.costUsd >= MAX_CAP_USD) {
        console.log(JSON.stringify({ event: "evaluation_soft_stop", runId, processed, requested: articles.length, usage: before, nextBatchEstimateUsd: estimate }));
        break;
      }

      const pipelineIds = await enqueueBatch(ai, { tenantId, companyId, runId, batch });
      const terminal = await waitForBatch(ai, { tenantId, companyId, pipelineIds, pollMs: args.pollMs, timeoutMs: args.batchTimeoutMs });
      processed += batch.length;
      const usage = await readUsage(ai, tenantId, companyId);
      console.log(JSON.stringify({ event: "evaluation_batch_complete", runId, processed, requested: articles.length, batchSize: batch.length, terminal, usage }));
      if (usage.costUsd >= SOFT_CAP_USD || usage.costUsd >= MAX_CAP_USD) {
        console.log(JSON.stringify({ event: "evaluation_hard_stop", runId, processed, requested: articles.length, usage }));
        break;
      }
    }

    const summary = await readSummary(ai, { tenantId, companyId });
    console.log(JSON.stringify({ event: "evaluation_complete", runId, tenantId, companyId, processed, requested: articles.length, summary, usage: await readUsage(ai, tenantId, companyId) }));
    console.log(`KEEP_SCOPE tenant=${tenantId} company=${companyId}`);
  } finally {
    await ai.end();
    await crawl.end();
  }
}

async function loadSourceScope(db, requestedName) {
  const result = await db.query(`
    SELECT c.id AS company_id, c.tenant_id, c.name, cc.version AS context_version,
           cc.content_jsonb AS context_content, mi.identity_jsonb AS identity_content,
           mi.provenance_jsonb AS identity_provenance
    FROM ai.companies c
    JOIN ai.company_contexts cc ON cc.tenant_id=c.tenant_id AND cc.company_id=c.id AND cc.status='effective'
    JOIN ai.management_identities mi ON mi.tenant_id=c.tenant_id AND mi.company_id=c.id
      AND mi.context_version=cc.version AND mi.status='ready'
    WHERE c.status='active' AND c.name ILIKE $1
    ORDER BY c.created_at
    LIMIT 1`, [requestedName ? `%${requestedName}%` : "%Arunika%"]);
  if (!result.rows[0]) throw new Error("No active source company with effective context and ready identity found");
  return result.rows[0];
}

async function selectArticles(db, limit) {
  const result = await db.query(`
    SELECT a.article_id, a.source_id, a.content_hash, a.canonical_url, a.title,
           a.content_text, a.published_at, a.collected_at
    FROM public.articles a
    WHERE a.validation_status IN ('valid', 'stored', 'parsed', 'published')
      AND a.content_hash ~ '^[a-f0-9]{8,128}$'
      AND length(coalesce(a.content_text, '')) >= 300
      AND a.canonical_url IS NOT NULL
    ORDER BY a.published_at DESC NULLS LAST, a.article_id DESC
    LIMIT $1`, [Math.max(limit * 2, limit)]);
  const seen = new Set();
  const selected = [];
  for (const row of result.rows) {
    const key = `${row.source_id}:${row.content_hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({
      sourceArticleId: formatCrawlIssueSourceId({ sourceId: row.source_id, contentHash: row.content_hash }),
      sourceSnapshotId: `eval-snapshot-${row.article_id}`,
      sourceId: row.source_id,
      contentHash: row.content_hash,
      articleId: String(row.article_id),
      title: row.title,
      canonicalUrl: row.canonical_url,
      contentLength: row.content_text?.length || 0,
      publishedAt: row.published_at,
      collectedAt: row.collected_at,
    });
    if (selected.length === limit) break;
  }
  return selected;
}

async function createEvaluationScope(db, { tenantId, companyId, runId, source }) {
  await db.query("BEGIN");
  try {
    await db.query("INSERT INTO ai.tenants (id,name,status) VALUES ($1,$2,'active')", [tenantId, `AI Evaluation ${runId}`]);
    await db.query("INSERT INTO ai.companies (id,tenant_id,name,status) VALUES ($1,$2,$3,'active')", [companyId, tenantId, `${source.name} [AI Evaluation ${runId}]`]);
    await db.query(`INSERT INTO ai.company_contexts
      (id,tenant_id,company_id,version,content_jsonb,source,status,updated_by)
      VALUES ($1,$2,$3,$4,$5::jsonb,'evaluation_snapshot','effective','codex-evaluation')`, [randomUUID(), tenantId, companyId, source.context_version, JSON.stringify(source.context_content)]);
    await db.query(`INSERT INTO ai.management_identities
      (id,tenant_id,company_id,context_version,status,identity_jsonb,provenance_jsonb,error_message)
      VALUES ($1,$2,$3,$4,'ready',$5::jsonb,$6::jsonb,NULL)`, [randomUUID(), tenantId, companyId, source.context_version, JSON.stringify(source.identity_content), JSON.stringify({ ...source.identity_provenance, evaluationSnapshot: true })]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

async function enqueueBatch(db, { tenantId, companyId, runId, batch }) {
  const pipelineIds = [];
  await db.query("BEGIN");
  try {
    for (const article of batch) {
      const pipelineId = randomUUID();
      pipelineIds.push(pipelineId);
      await db.query(`INSERT INTO ai.pipeline_states
        (id,tenant_id,company_id,current_task_id,status,version)
        VALUES ($1,$2,$3,'T02','queued',1)`, [pipelineId, tenantId, companyId]);
      const payload = {
        pipeline_id: pipelineId,
        task_id: "T02",
        expected_state_version: 1,
        input: { article_id: article.sourceArticleId, locale: "id", source_snapshot_id: article.sourceSnapshotId, trace_id: runId },
        model: "nano",
        next_task_id: "T03",
      };
      await db.query(`INSERT INTO ai.queue_jobs
        (id,tenant_id,company_id,queue_name,job_type,idempotency_key,payload_jsonb,status,max_attempts,available_at)
        VALUES ($1,$2,$3,$4,'T02',$5,$6::jsonb,'queued',3,now())`, [randomUUID(), tenantId, companyId, TASK_QUEUE, `evaluation-${runId}-${article.articleId}`, JSON.stringify(payload)]);
    }
    await db.query("COMMIT");
    return pipelineIds;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

async function waitForBatch(db, { tenantId, companyId, pipelineIds, pollMs, timeoutMs }) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await db.query(`
      SELECT
        count(*) FILTER (WHERE status IN ('queued','running','retrying'))::int AS pending,
        count(*) FILTER (WHERE status='succeeded')::int AS succeeded,
        count(*) FILTER (WHERE status='dead_letter')::int AS dead_letter,
        count(*)::int AS total
      FROM ai.pipeline_states
      WHERE tenant_id=$1 AND company_id=$2 AND id = ANY($3::text[])`, [tenantId, companyId, pipelineIds]);
    const row = result.rows[0];
    if (Number(row.total) >= pipelineIds.length && Number(row.pending) === 0) return row;
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for evaluation batch after ${timeoutMs}ms`);
}

async function readUsage(db, tenantId, companyId) {
  const result = await db.query(`
    SELECT task, payload_jsonb AS payload, NULL::jsonb AS provenance, output_jsonb AS output
    FROM ai.stage_runs
    WHERE tenant_id=$1 AND company_id=$2
    UNION ALL
    SELECT 'T02' AS task, payload_jsonb AS payload, NULL::jsonb AS provenance, NULL::jsonb AS output
    FROM ai.article_relevance WHERE tenant_id=$1 AND company_id=$2
    UNION ALL
    SELECT 'T07' AS task, provenance_jsonb AS payload, provenance_jsonb AS provenance, analysis_jsonb AS output
    FROM ai.issue_analyses WHERE tenant_id=$1 AND company_id=$2`, [tenantId, companyId]);
  const totals = { requests: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  const seen = new Set();
  for (const row of result.rows) walkUsage(row, row.task, totals, seen);
  const costUsd = totals.inputTokens * INPUT_PRICE + totals.cachedInputTokens * CACHED_INPUT_PRICE + totals.outputTokens * OUTPUT_PRICE;
  return { ...totals, costUsd: Number(costUsd.toFixed(6)) };
}

function walkUsage(value, task, totals, seen) {
  if (!value || typeof value !== "object") return;
  if (value.requestId && value.usage && !seen.has(value.requestId)) {
    seen.add(value.requestId);
    totals.requests += 1;
    totals.inputTokens += Number(value.usage.inputTokens || value.usage.input_tokens || 0);
    totals.cachedInputTokens += Number(value.usage.cachedInputTokens || value.usage.cached_input_tokens || 0);
    totals.outputTokens += Number(value.usage.outputTokens || value.usage.output_tokens || 0);
  }
  for (const child of Object.values(value)) walkUsage(child, task, totals, seen);
}

async function readSummary(db, { tenantId, companyId }) {
  const queries = await Promise.all([
    db.query("SELECT relevance, count(*)::int AS count FROM ai.article_relevance WHERE tenant_id=$1 AND company_id=$2 GROUP BY relevance ORDER BY relevance", [tenantId, companyId]),
    db.query("SELECT status, count(*)::int AS count FROM ai.queue_jobs WHERE tenant_id=$1 AND company_id=$2 GROUP BY status ORDER BY status", [tenantId, companyId]),
    db.query("SELECT count(*)::int AS count FROM ai.issues WHERE tenant_id=$1 AND company_id=$2", [tenantId, companyId]),
    db.query("SELECT count(*)::int AS count FROM ai.issue_analyses WHERE tenant_id=$1 AND company_id=$2 AND status='current'", [tenantId, companyId]),
    db.query("SELECT count(*)::int AS count FROM ai.issue_priorities WHERE tenant_id=$1 AND company_id=$2", [tenantId, companyId]),
  ]);
  return {
    relevance: queries[0].rows,
    jobs: queries[1].rows,
    issues: queries[2].rows[0]?.count || 0,
    currentAnalyses: queries[3].rows[0]?.count || 0,
    priorities: queries[4].rows[0]?.count || 0,
  };
}

function estimateNextBatchUsd(usage, batchSize, fallbackPerArticle) {
  if (usage.requests === 0) return fallbackPerArticle * batchSize;
  return Math.max(fallbackPerArticle * batchSize, (usage.costUsd / Math.max(1, usage.requests)) * batchSize * 12);
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function parseArgs(argv) {
  const args = { limit: 10, batchSize: 10, pollMs: 5000, batchTimeoutMs: 3_600_000, estimatedUsdPerArticle: 0.08, sourceCompany: "Arunika" };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--help") args.help = true;
    else if (value === "--cleanup-tenant") args.cleanupTenant = argv[++i];
    else if (value === "--limit") args.limit = positive(argv[++i], "limit");
    else if (value === "--batch-size") args.batchSize = positive(argv[++i], "batch-size");
    else if (value === "--run-id") args.runId = argv[++i];
    else if (value === "--source-company") args.sourceCompany = argv[++i];
    else if (value === "--poll-ms") args.pollMs = positive(argv[++i], "poll-ms");
    else if (value === "--estimated-usd-per-article") args.estimatedUsdPerArticle = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (args.batchSize > args.limit) args.batchSize = args.limit;
  if (!Number.isFinite(args.estimatedUsdPerArticle) || args.estimatedUsdPerArticle <= 0) throw new Error("estimated-usd-per-article must be positive");
  return args;
}

function positive(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function cleanupTenant(db, tenantId) {
  await db.query("BEGIN");
  try {
    for (const table of [
      "ai.alert_events", "ai.issue_developments", "ai.issue_articles", "ai.issue_priorities",
      "ai.issue_analyses", "ai.issues", "ai.article_relevance", "ai.stage_runs", "ai.pipeline_states",
      "ai.queue_jobs", "ai.management_identities", "ai.company_contexts", "ai.companies", "ai.tenants",
    ]) {
      const predicate = table === "ai.tenants" ? "id=$1" : "tenant_id=$1";
      await db.query(`DELETE FROM ${table} WHERE ${predicate}`, [tenantId]);
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

function usage() { console.log("Usage: node scripts/run-ai-pipeline-evaluation.js [--limit 10] [--batch-size 10] [--source-company Arunika] [--run-id id] [--cleanup-tenant tenant-id]"); }

main().catch((error) => { console.error(JSON.stringify({ event: "evaluation_failed", code: error.code || "EVALUATION_FAILED", message: error.message })); process.exitCode = 1; });
