"use strict";

const { CRAWL_SOURCE_IDS } = require("../news-feed/channel-registry");

const JOB_TYPE_BY_MODE = Object.freeze({
  poll: "cms.poll",
  article: "cms.article.trigger",
  "crawl-poll": "crawl.poll",
});

const ALLOWED_MODES = Object.freeze(["poll", "article", "crawl-poll"]);
const ALLOWED_LOCALES = Object.freeze(["id", "en", "uz"]);
const FORBIDDEN_CONTENT_FIELDS = Object.freeze(["content", "title", "summary", "article"]);

const COPY = Object.freeze({
  internal: Object.freeze({
    content: "Ingest trigger does not accept article content; worker reads CMS",
    mode: "Ingest requires mode, supported locale, and a bounded article limit",
    crawl: "Crawl ingest requires a registered crawl_source_id",
  }),
  human: Object.freeze({
    content: "Pull articles does not accept article content; the system fetches sources directly",
    mode: "Pull articles requires a supported action, locale (id, en, or uz), and a bounded limit (1–100)",
    crawl: "Crawl pull requires one registered media source id",
  }),
});

function validationError(message) {
  return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 });
}

function parseIngestTriggerBody(body = {}, { copy = "internal" } = {}) {
  const messages = COPY[copy] || COPY.internal;
  if (FORBIDDEN_CONTENT_FIELDS.some((field) => Object.hasOwn(body || {}, field))) {
    throw validationError(messages.content);
  }

  const mode = body?.mode || "poll";
  const locale = body?.locale || "id";
  const limit = body?.limit || 50;

  if (
    !ALLOWED_MODES.includes(mode)
    || !ALLOWED_LOCALES.includes(locale)
    || !Number.isInteger(limit)
    || limit < 1
    || limit > 100
    || (mode === "article" && typeof body?.article_id !== "string")
  ) {
    throw validationError(messages.mode);
  }

  if (mode === "crawl-poll" && !CRAWL_SOURCE_IDS.includes(body?.crawl_source_id)) {
    throw validationError(messages.crawl);
  }

  const payload = {
    mode,
    locale,
    limit,
    article_id: mode === "article" ? body.article_id : null,
    crawl_source_id: mode === "crawl-poll" ? body.crawl_source_id : null,
  };

  return { mode, locale, limit, payload, jobType: JOB_TYPE_BY_MODE[mode] };
}

async function enqueueIngestTrigger({
  queue,
  tenantId,
  companyId,
  body,
  idempotencyKey,
  maxAttempts = 3,
  copy = "internal",
  assertIntakeReady = null,
}) {
  const parsed = parseIngestTriggerBody(body, { copy });
  if (typeof assertIntakeReady === "function") {
    await assertIntakeReady({ tenantId, companyId });
  }
  const result = await queue.enqueue({
    tenantId,
    companyId,
    queueName: "ingest",
    jobType: parsed.jobType,
    idempotencyKey,
    payload: parsed.payload,
    maxAttempts,
  });
  return { parsed, reused: result.reused, job: result.job };
}

function requireIdempotencyKey(req, res, next, sendError) {
  const key = req.get("Idempotency-Key");
  if (!key || key.length < 16 || key.length > 255) {
    return sendError(res, req, validationError("Idempotency-Key header must be 16 to 255 characters"));
  }
  return next();
}

module.exports = {
  JOB_TYPE_BY_MODE,
  ALLOWED_MODES,
  ALLOWED_LOCALES,
  FORBIDDEN_CONTENT_FIELDS,
  parseIngestTriggerBody,
  enqueueIngestTrigger,
  requireIdempotencyKey,
  validationError,
};
