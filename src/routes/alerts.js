const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");
const { T12_PROMPT_VERSION } = require("../ai/tasks/t12-direct-blurbs/definition");

function createAlertRouter({ getAlertRuntime, getT12Service, getAlertBlurbStore, getEmailDeliveryService } = {}) {
  const router = express.Router(); const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "alert.read" });
  const preferenceScope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "alert.preference.manage", humanOnly: true });
  const pipelineScope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "ai.pipeline.run" });
  router.get("/api/v1/companies/:companyId/alert-preference", scope, asyncHandler(async (req, res) => {
    if (req.params.companyId !== req.authContext.companyId) throw scopeError();
    const recipientId = req.query.recipient_id || req.authContext.actor.actorId;
    const preference = await getAlertRuntime().preferenceStore.get({ tenantId: req.authContext.tenantId, companyId: req.params.companyId, recipientId }) || await getAlertRuntime().preferenceStore.getAny({ tenantId: req.authContext.tenantId, companyId: req.params.companyId });
    if (!preference) throw Object.assign(new Error("Alert preference was not found"), { code: "NOT_FOUND", statusCode: 404 });
    return success(res, serializePreference(preference), req);
  }));
  router.get("/api/v1/inbox/emails", scope, asyncHandler(async (req, res) => {
    const page = positiveInt(req.query.page, 1); const limit = boundedInt(req.query.limit, 20, 100);
    const channel = optionalChannel(req.query.channel);
    const result = await getAlertRuntime().eventStore.listScoped({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, recipientId: req.authContext.actor.actorId, channel, page, limit });
    const items = await serializeInboxItems(result.items, { tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, getAlertBlurbStore, getT12Service });
    return success(res, { items, meta: { page: result.page, limit: result.limit, total: result.total, unread_by_channel: result.unreadByChannel || {} } }, req);
  }));
  router.get("/api/v1/inbox/emails/:emailId", scope, asyncHandler(async (req, res) => {
    const event = await getAlertRuntime().eventStore.get({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, alertEventId: req.params.emailId });
    if (!event) throw Object.assign(new Error("Inbox email was not found"), { code: "NOT_FOUND", statusCode: 404 });
    const item = await serializeInboxItems([event], { tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, getAlertBlurbStore, getT12Service });
    return success(res, item[0], req);
  }));
  router.patch("/api/v1/inbox/emails/:emailId/read", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (typeof req.body?.read !== "boolean") throw validationError("read must be boolean");
    const event = await getAlertRuntime().eventStore.markRead({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, alertEventId: req.params.emailId, read: req.body.read });
    if (!event) throw Object.assign(new Error("Inbox email was not found"), { code: "NOT_FOUND", statusCode: 404 });
    const item = await serializeInboxItems([event], { tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, getAlertBlurbStore, getT12Service });
    return success(res, item[0], req);
  }));
  router.put("/api/v1/companies/:companyId/alert-preference", preferenceScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (req.params.companyId !== req.authContext.companyId) throw scopeError();
    validatePreferencePayload(req.body);
    const runtime = getAlertRuntime();
    const preference = await runtime.preferenceStore.upsert({ tenantId: req.authContext.tenantId, companyId: req.params.companyId, recipientId: req.body?.recipient_id, directHighEnabled: req.body?.direct_high_enabled, dailyDigestEnabled: req.body?.daily_digest_enabled, timezone: req.body?.timezone, quietHours: req.body?.quiet_hours ?? null });
    return success(res, serializePreference(preference), req);
  }));
  router.post("/api/v1/internal/alerts/eligibility", pipelineScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (req.body?.tenant_id !== req.authContext.tenantId || req.body?.company_id !== req.authContext.companyId) throw scopeError();
    const decision = await getAlertRuntime().service.evaluate({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, issueId: req.body?.issue_id, developmentId: req.body?.development_id, recipientId: req.body?.recipient_id });
    return success(res, { decision: serializeDecision(decision.decision), email_send: false }, req);
  }));
  router.post("/api/v1/internal/alerts/:alertEventId/direct-blurb", pipelineScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    rejectModelBoundaryFields(req.body);
    const result = await getT12Service().generate({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, alertEventId: req.params.alertEventId });
    return success(res, { blurb: serializeBlurb(result.blurb), reused: result.reused, email_send: false }, req);
  }));
  router.post("/api/v1/internal/alerts/:alertEventId/deliver", pipelineScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    rejectModelBoundaryFields(req.body);
    const result = await getEmailDeliveryService().deliver({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, alertEventId: req.params.alertEventId });
    return success(res, { delivery: serializeDelivery(result.delivery), reused: result.reused, email_send: result.delivery.status === "sent" }, req);
  }));
  router.use((error, req, res, _next) => sendError(res, req, error)); return router;
}
function serializePreference(p) { return { recipient_id: p.recipientId, direct_high_enabled: p.directHighEnabled, daily_digest_enabled: p.dailyDigestEnabled, timezone: p.timezone, quiet_hours: p.quietHours }; }
async function serializeInboxItems(events, options) {
  const directIds = events.filter((event) => event.channel === "langsung").map((event) => event.alertEventId);
  const store = resolveAlertBlurbStore(options);
  let blurbs = [];
  try {
    if (store?.listByAlertEventIds) {
      blurbs = await store.listByAlertEventIds({ tenantId: options.tenantId, companyId: options.companyId, alertEventIds: directIds, promptVersion: T12_PROMPT_VERSION });
    } else if (store?.get) {
      blurbs = await Promise.all(directIds.map((alertEventId) => store.get({ alertEventId, promptVersion: T12_PROMPT_VERSION })));
    }
  } catch {
    // Brief content is an optional read model. A missing stage-run read must not hide the alert delivery event.
    blurbs = [];
  }
  const byEventId = new Map(blurbs.filter(Boolean).filter((blurb) => blurb.tenantId === options.tenantId && blurb.companyId === options.companyId).map((blurb) => [blurb.alertEventId, blurb]));
  return events.map((event) => serializeInboxItem(event, serializeAlertBrief(byEventId.get(event.alertEventId))));
}
function resolveAlertBlurbStore({ getAlertBlurbStore, getT12Service }) {
  try {
    return typeof getAlertBlurbStore === "function" ? getAlertBlurbStore() : typeof getT12Service === "function" ? getT12Service()?.blurbStore : null;
  } catch {
    return null;
  }
}
function serializeInboxItem(event, alertContent = null) { return { email_id: event.alertEventId, issue_id: event.issueId, development_id: event.developmentId, channel: event.channel, status: event.status, reason_code: event.reasonCode, read: event.read === true, created_at: event.createdAt, alert_content: alertContent }; }
function serializeAlertBrief(blurb) {
  if (!blurb) return null;
  return { type: "direct", new_development: blurb.newDevelopmentBlurb || null, short_impact: blurb.shortImpactBlurb || null, source_claim_ids: Array.isArray(blurb.sourceClaimIds) ? blurb.sourceClaimIds : [], generated_at: blurb.createdAt || null };
}
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
function validationError(message) { return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 }); }
function positiveInt(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function boundedInt(value, fallback, max) { return Math.min(positiveInt(value, fallback), max); }
function optionalChannel(value) { if (value === undefined || value === null || value === "") return null; if (value === "langsung" || value === "ringkasan") return value; throw validationError("channel must be langsung or ringkasan"); }
function scopeError() { return Object.assign(new Error("Alert request scope does not match authenticated context"), { code: "SCOPE_CONTEXT_UNTRUSTED", statusCode: 403 }); }
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, Object.assign(new Error("Idempotency-Key header must be 16 to 255 characters"), { code: "VALIDATION_ERROR", statusCode: 400 })); return next(); }
function success(res, data, req) { return res.status(200).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createAlertRouter };
