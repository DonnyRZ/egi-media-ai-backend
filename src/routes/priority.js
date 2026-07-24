const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createPriorityRouter({ getT09Service, getT10Service } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "ai.pipeline.run" });
  router.post("/api/v1/internal/issues/:issueId/priority", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getT09Service().evaluate({ ...authScope(req), issueId: req.params.issueId, analysisId: req.body?.analysis_id });
    return success(res, { priority: result.priority, issue: result.issue, analysis_id: result.analysis.analysisId, reused: result.reused, top5: false }, req);
  }));
  router.post("/api/v1/internal/issues/:issueId/priority/reason", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getT10Service().generate({ ...authScope(req), issueId: req.params.issueId, analysisId: req.body?.analysis_id, priorityDecisionId: req.body?.priority_decision_id });
    return success(res, { reason: result.reason, priority: result.priorityDecision, analysis_id: result.analysis.analysisId, top5: false }, req);
  }));
  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}
function authScope(req) { return { tenantId: req.authContext.tenantId, companyId: req.authContext.companyId }; }
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, Object.assign(new Error("Idempotency-Key header must be 16 to 255 characters"), { code: "VALIDATION_ERROR", statusCode: 400 })); return next(); }
function success(res, data, req) { return res.status(200).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createPriorityRouter };
