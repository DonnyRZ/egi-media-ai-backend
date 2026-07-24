const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createRelevanceRouter({ getT02Service, getT03Service } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "ai.pipeline.run" });

  router.post("/api/v1/internal/relevance/classify", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const companyId = scopedCompany(req, req.body?.company_id);
    const result = await getT02Service().classify({ tenantId: req.authContext.tenantId, companyId, articleId: req.body?.article_id, locale: req.body?.locale || "id" });
    return success(res, { decision: serializeDecision(result.decision), reused: result.reused, should_continue: result.shouldContinue }, req);
  }));

  router.post("/api/v1/internal/relevance/rationale", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const companyId = scopedCompany(req, req.body?.company_id);
    const result = await getT03Service().generate({ tenantId: req.authContext.tenantId, companyId, decisionId: req.body?.decision_id });
    return success(res, { decision: serializeDecision(result.decision), rationale: serializeRationale(result.rationale), reused: result.reused }, req);
  }));

  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}

function scopedCompany(req, requestedCompanyId) {
  if (!requestedCompanyId || requestedCompanyId !== req.authContext.companyId) {
    const error = Object.assign(new Error("Company scope does not match the authenticated context"), { code: "SCOPE_CONTEXT_UNTRUSTED", statusCode: 403 });
    throw error;
  }
  return requestedCompanyId;
}

function requireIdempotencyKey(req, res, next) {
  const key = req.get("Idempotency-Key");
  if (!key || key.length < 16 || key.length > 255) return sendError(res, req, Object.assign(new Error("Idempotency-Key header must be 16 to 255 characters"), { code: "VALIDATION_ERROR", statusCode: 400 }));
  return next();
}

function serializeDecision(value) {
  return { decision_id: value.decisionId, article_id: value.articleId, company_id: value.companyId, context_version: value.contextVersion, relevance: value.relevance, confidence: value.confidence, branch: value.branch, source: value.source, created_at: value.createdAt };
}
function serializeRationale(value) { return { rationale_id: value.rationaleId, decision_id: value.decisionId, company_id: value.companyId, prompt_version: value.promptVersion, rationale: value.rationale, created_at: value.createdAt }; }
function success(res, data, req) { return res.status(200).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

module.exports = { createRelevanceRouter };
