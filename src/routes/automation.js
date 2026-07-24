const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createAutomationRouter({ getStatus, getJobs } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "ai.pipeline.run" });
  router.get("/api/v1/internal/automation/status", scope, asyncHandler(async (req, res) => success(res, await getStatus(req), req)));
  router.get("/api/v1/internal/automation/jobs", scope, asyncHandler(async (req, res) => success(res, await getJobs(req), req)));
  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}
function success(res, data, req) { return res.json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createAutomationRouter };
