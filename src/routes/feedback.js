const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");
function createFeedbackRouter({ getFeedbackStore } = {}) {
  const router = express.Router();
  router.post("/api/v1/feedback", requireAuthContext({ tenant: true, company: true, trustedScope: true }), requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (req.authContext.actor?.actorType !== "human") throw Object.assign(new Error("Feedback requires a human actor"), { code: "FORBIDDEN", statusCode: 403 });
    const body = req.body || {};
    if (!["issue", "report", "analysis"].includes(body.target_type) || typeof body.target_id !== "string" || !body.target_id.trim() || !["helpful", "not_helpful", "incorrect", "missing_context", "other"].includes(body.type) || (body.comment !== undefined && (typeof body.comment !== "string" || body.comment.length > 2000))) throw validationError("Feedback payload is invalid");
    const result = await getFeedbackStore().create({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, actorId: req.authContext.actor.actorId, targetType: body.target_type, targetId: body.target_id, type: body.type, comment: body.comment, idempotencyKey: req.get("Idempotency-Key") });
    return res.status(result.reused ? 200 : 201).json({ success: true, data: { id: result.feedback.id, created_at: result.feedback.createdAt, reused: result.reused }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
  }));
  router.use((error, req, res, _next) => sendError(res, req, error)); return router;
}
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, validationError("Idempotency-Key header must be 16 to 255 characters")); return next(); }
function validationError(message) { return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createFeedbackRouter };
