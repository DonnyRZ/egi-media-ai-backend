const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createIngestRouter({ getIngestRuntime } = {}) {
  const router = express.Router(); const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "ai.pipeline.run" });
  router.post("/api/v1/internal/pipeline/ingest", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const mode = req.body?.mode || "poll"; const locale = req.body?.locale || "id"; const limit = req.body?.limit || 50;
    if (["content", "title", "summary", "article"].some((field) => Object.hasOwn(req.body || {}, field))) throw validationError("Ingest trigger does not accept article content; worker reads CMS");
    if (!["poll", "article"].includes(mode) || !["id", "en", "uz"].includes(locale) || !Number.isInteger(limit) || limit < 1 || limit > 100 || (mode === "article" && typeof req.body?.article_id !== "string")) throw validationError("Ingest requires mode, supported locale, and a bounded article limit");
    const idempotencyKey = req.get("Idempotency-Key"); const payload = { mode, locale, limit, article_id: mode === "article" ? req.body.article_id : null };
    const result = await getIngestRuntime().queue.enqueue({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, queueName: "ingest", jobType: mode === "poll" ? "cms.poll" : "cms.article.trigger", idempotencyKey, payload, maxAttempts: 3 });
    return res.status(202).json({ success: true, data: { id: result.job.jobId, trigger: "ingest", state: result.job.status, reused: result.reused, stages: [{ name: "ingest", state: result.job.status, updated_at: result.job.updatedAt }] }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
  }));
  router.use((error, req, res, _next) => sendError(res, req, error)); return router;
}
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, validationError("Idempotency-Key header must be 16 to 255 characters")); return next(); }
function validationError(message) { return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createIngestRouter };
