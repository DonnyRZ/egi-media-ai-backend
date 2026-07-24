const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createDashboardRouter({ getExecutiveSummaryService, getIssueReadService } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "dashboard.read" });
  router.get("/api/v1/dashboard/executive-summary", scope, asyncHandler(async (req, res) => {
    const companyId = scopedCompany(req, req.query.company_id || req.authContext.companyId);
    const result = await getExecutiveSummaryService().getExecutiveSummary({ tenantId: req.authContext.tenantId, companyId, period: req.query.period || "24jam" });
    return success(res, { ...result, issues: result.items, top5_limit: 5 }, req);
  }));
  router.get("/api/v1/issues", scope, asyncHandler(async (req, res) => {
    const companyId = scopedCompany(req, req.query.company_id || req.authContext.companyId);
    const page = positiveInt(req.query.page, 1); const limit = Math.min(100, positiveInt(req.query.limit, 20));
    const result = await getIssueReadService().list({ tenantId: req.authContext.tenantId, companyId, q: req.query.q, status: req.query.status, priority: req.query.priority, period: req.query.period || null, page, limit });
    return success(res, { items: result.items, meta: { page: result.page, limit: result.limit, total: result.total } }, req);
  }));
  router.get("/api/v1/issues/:issueId", scope, asyncHandler(async (req, res) => {
    const result = await getIssueReadService().detail({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, issueId: req.params.issueId });
    return success(res, result, req);
  }));
  router.use((error, req, res, _next) => sendError(res, req, error)); return router;
}
function scopedCompany(req, companyId) { if (companyId !== req.authContext.companyId) throw Object.assign(new Error("Company scope does not match authenticated context"), { code: "SCOPE_CONTEXT_UNTRUSTED", statusCode: 403 }); return companyId; }
function positiveInt(value, fallback) { if (value === undefined) return fallback; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw Object.assign(new Error("Pagination value is invalid"), { code: "VALIDATION_ERROR", statusCode: 400 }); return parsed; }
function success(res, data, req) { return res.status(200).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createDashboardRouter };
