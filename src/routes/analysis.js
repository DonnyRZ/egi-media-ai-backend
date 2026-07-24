const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createAnalysisRouter({ getT07Service, getT08Service, getCitationGate } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "ai.pipeline.run" });

  router.post("/api/v1/internal/issues/:issueId/analyze", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getT07Service().analyze({ ...authScope(req), issueId: req.params.issueId });
    return success(res, { analysis: result.analysis, reused: result.reused }, req);
  }));

  router.post("/api/v1/internal/analyses/:analysisId/labels", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getT08Service().label({ ...authScope(req), analysisId: req.params.analysisId });
    return success(res, { labels: result.labels, reused: result.reused }, req);
  }));

  router.post("/api/v1/internal/analyses/:analysisId/promote-current", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const current = await getCitationGate().validateAndPromote({ ...authScope(req), analysisId: req.params.analysisId });
    return success(res, { analysis: current }, req);
  }));

  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}
function authScope(req) { return { tenantId: req.authContext.tenantId, companyId: req.authContext.companyId }; }
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, Object.assign(new Error("Idempotency-Key header must be 16 to 255 characters"), { code: "VALIDATION_ERROR", statusCode: 400 })); return next(); }
function success(res, data, req) { return res.status(200).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createAnalysisRouter };
