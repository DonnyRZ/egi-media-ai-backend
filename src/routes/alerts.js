const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createAlertRouter({ getAlertRuntime, getT12Service, getEmailDeliveryService } = {}) {
  const router = express.Router(); const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true });
  router.put("/api/v1/companies/:companyId/alert-preference", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (req.params.companyId !== req.authContext.companyId) throw scopeError();
    validatePreferencePayload(req.body);
    const runtime = getAlertRuntime();
    const preference = await runtime.preferenceStore.upsert({ tenantId: req.authContext.tenantId, companyId: req.params.companyId, recipientId: req.body?.recipient_id, directHighEnabled: req.body?.direct_high_enabled, dailyDigestEnabled: req.body?.daily_digest_enabled, timezone: req.body?.timezone, quietHours: req.body?.quiet_hours ?? null });
    return success(res, serializePreference(preference), req);
  }));
  router.post("/api/v1/internal/alerts/eligibility", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (req.body?.tenant_id !== req.authContext.tenantId || req.body?.company_id !== req.authContext.companyId) throw scopeError();
    const decision = await getAlertRuntime().service.evaluate({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, issueId: req.body?.issue_id, developmentId: req.body?.development_id, recipientId: req.body?.recipient_id });
    return success(res, { decision: serializeDecision(decision.decision), email_send: false }, req);
  }));
  router.post("/api/v1/internal/alerts/:alertEventId/direct-blurb", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    rejectModelBoundaryFields(req.body);
    const result = await getT12Service().generate({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, alertEventId: req.params.alertEventId });
    return success(res, { blurb: serializeBlurb(result.blurb), reused: result.reused, email_send: false }, req);
  }));
  router.post("/api/v1/internal/alerts/:alertEventId/deliver", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    rejectModelBoundaryFields(req.body);
    const result = await getEmailDeliveryService().deliver({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, alertEventId: req.params.alertEventId });
    return success(res, { delivery: serializeDelivery(result.delivery), reused: result.reused, email_send: result.delivery.status === "sent" }, req);
  }));
  router.use((error, req, res, _next) => sendError(res, req, error)); return router;
}
function serializePreference(p) { return { recipient_id: p.recipientId, direct_high_enabled: p.directHighEnabled, daily_digest_enabled: p.dailyDigestEnabled, timezone: p.timezone, quiet_hours: p.quietHours }; }
function serializeDecision(decision) { return { channel: decision.channel, status: decision.status, reason_code: decision.reasonCode }; }
function serializeBlurb(blurb) { return { direct_blurb_id: blurb.directBlurbId, alert_event_id: blurb.alertEventId, issue_id: blurb.issueId, development_id: blurb.developmentId, new_development_blurb: blurb.newDevelopmentBlurb, short_impact_blurb: blurb.shortImpactBlurb, source_claim_ids: blurb.sourceClaimIds, prompt_version: blurb.promptVersion, generated_at: blurb.createdAt }; }
function serializeDelivery(delivery) { return { delivery_id: delivery.deliveryId, alert_event_id: delivery.alertEventId, status: delivery.status, attempts: delivery.attempts.map((attempt) => ({ attempt: attempt.attempt, outcome: attempt.outcome, error_code: attempt.errorCode || null, at: attempt.at })) }; }
function rejectModelBoundaryFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  if (["recipient", "recipient_id", "email", "subject", "to"].some((field) => Object.hasOwn(body, field))) {
    throw Object.assign(new Error("Direct blurb API does not accept recipient or subject fields"), { code: "VALIDATION_ERROR", statusCode: 400 });
  }
}
function validatePreferencePayload(body) {
  if (!body || typeof body.recipient_id !== "string" || !body.recipient_id.trim() || typeof body.direct_high_enabled !== "boolean" || typeof body.daily_digest_enabled !== "boolean" || typeof body.timezone !== "string" || !body.timezone.trim()) {
    throw Object.assign(new Error("Alert preference fields are invalid"), { code: "VALIDATION_ERROR", statusCode: 400 });
  }
  const quietHours = body.quiet_hours;
  const validClock = (value) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (quietHours !== null && (!quietHours || typeof quietHours !== "object" || !validClock(quietHours.start) || !validClock(quietHours.end) || quietHours.start === quietHours.end)) {
    throw Object.assign(new Error("quiet_hours must be null or a valid non-zero time range"), { code: "VALIDATION_ERROR", statusCode: 400 });
  }
}
function scopeError() { return Object.assign(new Error("Alert request scope does not match authenticated context"), { code: "SCOPE_CONTEXT_UNTRUSTED", statusCode: 403 }); }
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, Object.assign(new Error("Idempotency-Key header must be 16 to 255 characters"), { code: "VALIDATION_ERROR", statusCode: 400 })); return next(); }
function success(res, data, req) { return res.status(200).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createAlertRouter };
