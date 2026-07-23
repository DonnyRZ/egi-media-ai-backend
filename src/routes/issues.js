const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createIssueFormationRouter({ getT04Service, getIssueMutationService, getT05Service, getT06Service } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true });

  router.post("/api/v1/internal/issues/match", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const context = bodyScope(req);
    const result = await getT04Service().match({ ...context, relevanceDecisionId: req.body?.relevance_decision_id });
    return success(res, { match: result.match, relevance_decision_id: result.relevanceDecision.decisionId, reused: result.reused }, req);
  }));

  router.post("/api/v1/internal/issues/form", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const context = bodyScope(req);
    const result = await getIssueMutationService().apply({ ...context, matchDecisionId: req.body?.match_decision_id });
    return success(res, { mutation: result.mutation, reused: result.reused }, req);
  }));

  router.post("/api/v1/internal/issues/:issueId/title", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getT05Service().generate({ ...authScope(req), issueId: req.params.issueId });
    return success(res, { title: result.title, issue: result.issue, reused: result.reused }, req);
  }));

  router.post("/api/v1/internal/issues/:issueId/one-liner", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getT06Service().generate({ ...authScope(req), issueId: req.params.issueId });
    return success(res, { one_liner: result.oneLiner, issue: result.issue, reused: result.reused }, req);
  }));

  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}

function authScope(req) { return { tenantId: req.authContext.tenantId, companyId: req.authContext.companyId }; }
function bodyScope(req) {
  const scope = authScope(req);
  if (req.body?.tenant_id !== scope.tenantId || req.body?.company_id !== scope.companyId) throw Object.assign(new Error("Request scope does not match authenticated context"), { code: "SCOPE_CONTEXT_UNTRUSTED", statusCode: 403 });
  return scope;
}
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, Object.assign(new Error("Idempotency-Key header must be 16 to 255 characters"), { code: "VALIDATION_ERROR", statusCode: 400 })); return next(); }
function success(res, data, req) { return res.status(200).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createIssueFormationRouter };
