const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");
const { enqueueIngestTrigger, requireIdempotencyKey } = require("../ingest/ingest-trigger");

function createIngestRouter({ getIngestRuntime, assertIntakeReady, getTenantStore } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "ai.pipeline.run" });
  router.post("/api/v1/internal/pipeline/ingest", scope, (req, res, next) => requireIdempotencyKey(req, res, next, sendError), asyncHandler(async (req, res) => {
    const idempotencyKey = req.get("Idempotency-Key");
    const result = await enqueueIngestTrigger({
      queue: getIngestRuntime().queue,
      tenantId: req.authContext.tenantId,
      companyId: req.authContext.companyId,
      body: req.body,
      idempotencyKey,
      maxAttempts: 3,
      copy: "internal",
      assertIntakeReady,
      getTenantStore,
    });
    return res.status(202).json({
      success: true,
      data: {
        id: result.job.jobId,
        trigger: "ingest",
        state: result.job.status,
        reused: result.reused,
        stages: [{ name: "ingest", state: result.job.status, updated_at: result.job.updatedAt }],
      },
      meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) },
    });
  }));
  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { createIngestRouter };
