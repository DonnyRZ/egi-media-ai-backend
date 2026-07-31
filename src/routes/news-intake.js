"use strict";

const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");
const { enqueueIngestTrigger, requireIdempotencyKey } = require("../ingest/ingest-trigger");
const { JOB_STATUSES } = require("../queue/job.store");

const INGEST_JOB_TYPES = Object.freeze(["cms.poll", "cms.article.trigger", "crawl.poll"]);
const INGEST_JOB_TYPE_SET = Object.freeze(new Set(INGEST_JOB_TYPES));
const DEFAULT_RUNS_LIMIT = 20;
const MAX_RUNS_LIMIT = 100;
const MAX_RUNS_OFFSET = 10_000;

/**
 * Human-facing News intake API (Settings / operators).
 * Does not expose T02–T14 pipeline internals. Reuses the same ingest enqueue path as
 * POST /api/v1/internal/pipeline/ingest; callers never submit article body.
 */
function createNewsIntakeRouter({
  getIngestRuntime,
  getStatus,
  getRecentRuns,
  setAutomaticIntake,
  assertIntakeReady,
  getIntakeReadiness,
  logger,
} = {}) {
  const router = express.Router();
  const readScope = requireAuthContext({
    tenant: true,
    company: true,
    trustedScope: true,
    permission: "news.intake.read",
  });
  const triggerScope = requireAuthContext({
    tenant: true,
    company: true,
    trustedScope: true,
    permission: "news.intake.trigger",
  });
  const manageScope = requireAuthContext({
    tenant: true,
    company: true,
    trustedScope: true,
    permission: "news.intake.manage",
  });

  router.get("/api/v1/news-intake/status", readScope, asyncHandler(async (req, res) => {
    const raw = typeof getStatus === "function" ? await getStatus(req) : {};
    const readiness = typeof getIntakeReadiness === "function"
      ? await getIntakeReadiness({
        tenantId: req.authContext.tenantId,
        companyId: req.authContext.companyId,
      })
      : null;
    const data = toNewsIntakeStatus(raw);
    if (readiness) {
      data.management_identity = {
        ready: Boolean(readiness.ready),
        status: readiness.status,
        context_version: readiness.contextVersion,
        has_effective_context: Boolean(readiness.hasEffectiveContext),
      };
      data.intake_ready = Boolean(readiness.ready);
    }
    return success(res, data, req);
  }));

  router.get("/api/v1/news-intake/runs", readScope, asyncHandler(async (req, res) => {
    const query = parseRunsQuery(req.query);
    let page;
    if (typeof getRecentRuns === "function") {
      page = await getRecentRuns(req, query);
      if (Array.isArray(page)) {
        page = paginateMappedRuns(page, query);
      }
    } else if (typeof getIngestRuntime === "function") {
      page = await listRecentRunsFromStore(getIngestRuntime().jobStore, {
        tenantId: req.authContext.tenantId,
        companyId: req.authContext.companyId,
        ...query,
      });
    } else {
      page = emptyRunsPage(query);
    }
    return success(res, page, req);
  }));

  router.post("/api/v1/news-intake/pull", triggerScope, (req, res, next) => requireIdempotencyKey(req, res, next, sendError), asyncHandler(async (req, res) => {
    const idempotencyKey = req.get("Idempotency-Key");
    const result = await enqueueIngestTrigger({
      queue: getIngestRuntime().queue,
      tenantId: req.authContext.tenantId,
      companyId: req.authContext.companyId,
      body: req.body,
      idempotencyKey,
      maxAttempts: 3,
      copy: "human",
      assertIntakeReady,
    });

    const log = logger || req.app?.locals?.logger;
    log?.info?.("news_intake_pull_requested", {
      tenantId: req.authContext.tenantId,
      companyId: req.authContext.companyId,
      actorId: req.authContext.actor?.actorId || null,
      role: req.authContext.role || null,
      mode: result.parsed.mode,
      locale: result.parsed.locale,
      limit: result.parsed.limit,
      crawl_source_id: result.parsed.payload.crawl_source_id,
      has_article_id: Boolean(result.parsed.payload.article_id),
      jobId: result.job.jobId,
      reused: result.reused,
      request_id: getRequestId(req),
      correlation_id: getCorrelationId(req),
    });

    return res.status(202).json({
      success: true,
      data: {
        id: result.job.jobId,
        action: result.parsed.mode,
        state: result.job.status,
        reused: result.reused,
        locale: result.parsed.locale,
        stages: [{ name: "intake", state: result.job.status, updated_at: result.job.updatedAt }],
      },
      meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) },
    });
  }));

  /**
   * Enable/disable Automatic intake (scheduler only). Idempotent.
   * Body: { "desired": true|false }
   */
  router.post("/api/v1/news-intake/automatic", manageScope, asyncHandler(async (req, res) => {
    if (!req.body || typeof req.body.desired !== "boolean") {
      const error = Object.assign(new Error("Body must include boolean desired"), {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
      return sendError(res, req, error);
    }
    if (typeof setAutomaticIntake !== "function") {
      const error = Object.assign(new Error("Automatic intake management is not available"), {
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
      });
      return sendError(res, req, error);
    }

    await setAutomaticIntake({
      desired: req.body.desired,
      actorId: req.authContext.actor?.actorId || null,
      role: req.authContext.role || null,
      req,
    });

    const raw = typeof getStatus === "function" ? await getStatus(req) : {};
    const mapped = toNewsIntakeStatus(raw);

    const log = logger || req.app?.locals?.logger;
    log?.info?.("news_intake_automatic_manage", {
      tenantId: req.authContext.tenantId,
      companyId: req.authContext.companyId,
      actorId: req.authContext.actor?.actorId || null,
      role: req.authContext.role || null,
      desired: req.body.desired,
      actual_running: mapped.automatic_intake.actual_running,
      request_id: getRequestId(req),
      correlation_id: getCorrelationId(req),
    });

    return success(res, mapped, req);
  }));

  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}

function toNewsIntakeStatus(raw = {}) {
  const automatic = raw.automatic_intake || {};
  const scheduler = raw.scheduler || {};
  const worker = raw.worker || {};

  const desired = firstDefined(
    automatic.desired,
    automatic.enabled,
    scheduler.enabled,
    false,
  );
  const actualRunning = firstDefined(
    automatic.actual_running,
    automatic.running,
    scheduler.running,
    false,
  );

  return {
    automatic_intake: {
      desired: Boolean(desired),
      actual_running: Boolean(actualRunning),
      // S2 aliases (enabled ≈ desired; running ≈ actual_running)
      enabled: Boolean(desired),
      running: Boolean(actualRunning),
      interval_ms: firstDefined(automatic.interval_ms, scheduler.interval_ms, null),
      batch_size: firstDefined(automatic.batch_size, null),
      locales: Array.isArray(automatic.locales)
        ? automatic.locales
        : (Array.isArray(scheduler.locales) ? scheduler.locales : []),
      last_enqueue_at: automatic.last_enqueue_at ?? null,
      last_enqueue_status: automatic.last_enqueue_status ?? null,
      last_error_code: automatic.last_error_code ?? null,
      last_job_id: automatic.last_job_id ?? null,
      desired_source: automatic.desired_source ?? null,
      desired_updated_at: automatic.desired_updated_at ?? null,
    },
    workers: {
      enabled: raw.workers_enabled !== undefined ? Boolean(raw.workers_enabled) : true,
      running: Boolean(worker.running),
    },
    pipeline: {
      configured: Boolean(raw.pipeline?.configured),
    },
  };
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * Parse and validate Recent runs query params.
 * @returns {{ limit: number, offset: number, status?: string, includeAiTasks: boolean, cursor?: string }}
 */
function parseRunsQuery(query = {}) {
  const hasOffset = query.offset !== undefined && query.offset !== null && query.offset !== "";
  const hasCursor = query.cursor !== undefined && query.cursor !== null && query.cursor !== "";
  if (hasOffset && hasCursor) {
    throw validationError("Provide cursor or offset, not both");
  }

  const limit = parseBoundedInt(query.limit, DEFAULT_RUNS_LIMIT, 1, MAX_RUNS_LIMIT, "limit");
  let offset = 0;
  if (hasCursor) {
    offset = decodeRunsCursor(query.cursor);
  } else if (hasOffset) {
    offset = parseBoundedInt(query.offset, 0, 0, MAX_RUNS_OFFSET, "offset");
  }

  let status;
  if (query.status !== undefined && query.status !== null && query.status !== "") {
    if (typeof query.status !== "string" || !JOB_STATUSES.includes(query.status)) {
      throw validationError(`status must be one of: ${JOB_STATUSES.join(", ")}`);
    }
    status = query.status;
  }

  const includeAiTasks = parseOptionalBoolean(query.include_ai_tasks, "include_ai_tasks");

  return { limit, offset, status, includeAiTasks };
}

function parseBoundedInt(value, fallback, min, max, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw validationError(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function parseOptionalBoolean(value, name) {
  if (value === undefined || value === null || value === "") return false;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw validationError(`${name} must be a boolean`);
}

function encodeRunsCursor(offset) {
  return Buffer.from(JSON.stringify({ v: 1, o: offset }), "utf8").toString("base64url");
}

function decodeRunsCursor(cursor) {
  if (typeof cursor !== "string") throw validationError("cursor is invalid");
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!decoded || decoded.v !== 1 || !Number.isInteger(decoded.o) || decoded.o < 0 || decoded.o > MAX_RUNS_OFFSET) {
      throw new Error("bad cursor");
    }
    return decoded.o;
  } catch {
    throw validationError("cursor is invalid");
  }
}

/**
 * List company-scoped Recent runs from a job store.
 * Always requires tenantId + companyId (no cross-company leakage).
 */
async function listRecentRunsFromStore(jobStore, {
  tenantId,
  companyId,
  status,
  limit = DEFAULT_RUNS_LIMIT,
  offset = 0,
  includeAiTasks = false,
} = {}) {
  if (!tenantId || !companyId) {
    throw Object.assign(new Error("Tenant and company context are required for Recent runs"), {
      code: "COMPANY_CONTEXT_REQUIRED",
      statusCode: 400,
    });
  }

  const listArgs = {
    tenantId,
    companyId,
    status,
    // Fetch one extra row to compute has_more without a separate count query.
    limit: limit + 1,
    offset,
  };

  if (!includeAiTasks) {
    listArgs.queueName = "ingest";
    listArgs.jobTypes = [...INGEST_JOB_TYPES];
  }

  const listed = await jobStore.list(listArgs);
  const jobs = Array.isArray(listed) ? listed : [];
  return paginateJobs(jobs, { limit, offset, includeAiTasks });
}

function paginateJobs(jobs, { limit, offset, includeAiTasks = false }) {
  const filtered = includeAiTasks
    ? jobs
    : jobs.filter((job) => job.queueName === "ingest" && INGEST_JOB_TYPE_SET.has(job.jobType));
  const hasMore = filtered.length > limit;
  const pageJobs = filtered.slice(0, limit);
  const items = pageJobs.map(mapRunItem);
  return buildRunsPage({ items, limit, offset, hasMore });
}

/** S2-compatible helper: map + slice (no offset). Prefer listRecentRunsFromStore. */
function mapRecentRuns(jobs = [], limit = DEFAULT_RUNS_LIMIT) {
  return [...jobs]
    .filter((job) => job.queueName === "ingest" && INGEST_JOB_TYPE_SET.has(job.jobType))
    .sort((a, b) => {
      const byCreated = Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
      if (byCreated !== 0) return byCreated;
      return String(b.jobId || "").localeCompare(String(a.jobId || ""));
    })
    .slice(0, limit)
    .map(mapRunItem);
}

function paginateMappedRuns(items, { limit, offset }) {
  const slice = items.slice(0, limit);
  const hasMore = items.length > limit;
  return buildRunsPage({ items: slice, limit, offset, hasMore });
}

function mapRunItem(job) {
  const mode = job.payload?.mode || modeFromJobType(job.jobType);
  const isIntake = job.queueName === "ingest" && INGEST_JOB_TYPE_SET.has(job.jobType);
  return {
    id: job.jobId,
    when: job.createdAt || null,
    source: sourceFromJob(job),
    mode,
    action: mode,
    state: job.status,
    locale: job.payload?.locale || null,
    crawl_source_id: job.payload?.crawl_source_id || null,
    job_type: job.jobType || null,
    family: isIntake ? "intake" : "ai_task",
    reused: typeof job.reused === "boolean" ? job.reused : null,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

function modeFromJobType(jobType) {
  if (jobType === "cms.poll") return "poll";
  if (jobType === "cms.article.trigger") return "article";
  if (jobType === "crawl.poll") return "crawl-poll";
  return null;
}

function sourceFromJob(job) {
  if (job.payload?.crawl_source_id) return job.payload.crawl_source_id;
  if (job.jobType === "crawl.poll") return job.payload?.crawl_source_id || null;
  if (job.jobType === "cms.poll" || job.jobType === "cms.article.trigger" || job.payload?.mode === "poll" || job.payload?.mode === "article") {
    return "egi-media-cms";
  }
  return null;
}

function buildRunsPage({ items, limit, offset, hasMore }) {
  const nextOffset = hasMore ? offset + items.length : null;
  return {
    items,
    limit,
    offset,
    has_more: Boolean(hasMore),
    next_offset: nextOffset,
    next_cursor: nextOffset != null ? encodeRunsCursor(nextOffset) : null,
  };
}

function emptyRunsPage({ limit = DEFAULT_RUNS_LIMIT, offset = 0 } = {}) {
  return buildRunsPage({ items: [], limit, offset, hasMore: false });
}

function validationError(message) {
  return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 });
}

function success(res, data, req) {
  return res.json({
    success: true,
    data,
    meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) },
  });
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = {
  createNewsIntakeRouter,
  toNewsIntakeStatus,
  mapRecentRuns,
  mapRunItem,
  parseRunsQuery,
  listRecentRunsFromStore,
  encodeRunsCursor,
  decodeRunsCursor,
  INGEST_JOB_TYPES,
  DEFAULT_RUNS_LIMIT,
  MAX_RUNS_LIMIT,
};
