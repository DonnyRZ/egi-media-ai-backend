const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");
const { validateReportPack } = require("../ai/tasks/t13-report-narrative/service");

function createReportRouter({ getReportRuntime } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true });
  router.post("/api/v1/internal/reports/drafts", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const payload = normalizeDraftPayload(req.body);
    const draft = buildDraftCandidate(req.authContext, payload);
    validateReportPack(draft);
    const stored = getReportRuntime().draftStore.create(draft);
    return success(res, serializeDraft(stored), req);
  }));
  router.post("/api/v1/internal/reports/:reportId/narrative", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getReportRuntime().narrativeService.generate({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, reportId: req.params.reportId });
    return success(res, { report: serializeDraft(result.report), narrative: serializeNarrative(result.narrative), reused: result.reused }, req);
  }));
  router.post("/api/v1/reports/:reportId/review", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (req.body?.action !== "submit") throw validationError("Only review submission is available in this lifecycle stage");
    const result = await getReportRuntime().lifecycleService.submitForReview({ ...actorScope(req), reportId: req.params.reportId, expectedVersion: readVersion(req), note: nullableNote(req.body?.comment) });
    return success(res, serializeDraft(result), req);
  }));
  router.post("/api/v1/reports/:reportId/approve", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getReportRuntime().lifecycleService.approve({ ...actorScope(req), reportId: req.params.reportId, expectedVersion: readVersion(req), note: nullableNote(req.body?.note) });
    return success(res, serializeDraft(result), req);
  }));
  router.post("/api/v1/reports/:reportId/share", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (!Array.isArray(req.body?.recipient_refs) || req.body.recipient_refs.length < 1 || req.body.recipient_refs.length > 100) throw validationError("recipient_refs must contain 1 to 100 references");
    const result = await getReportRuntime().lifecycleService.share({ ...actorScope(req), reportId: req.params.reportId, expectedVersion: readVersion(req), shareTarget: { recipientRefs: req.body.recipient_refs }, note: nullableNote(req.body?.message) });
    return success(res, serializeDraft(result), req, 202);
  }));
  router.post("/api/v1/reports/:reportId/narrative/:reportNarrativeId/rewrite", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (req.authContext.actor?.actorType !== "human") throw Object.assign(new Error("Constrained rewrite requires a human actor"), { code: "FORBIDDEN", statusCode: 403 });
    if (typeof req.body?.allowed_span_id !== "string" || !req.body.allowed_span_id.trim() || typeof req.body?.instruction !== "string" || !req.body.instruction.trim() || req.body.instruction.length > 1000) throw validationError("A bounded human rewrite instruction and allowed span are required");
    const result = await getReportRuntime().rewriteService.rewrite({ ...actorScope(req), reportId: req.params.reportId, reportNarrativeId: req.params.reportNarrativeId, expectedVersion: readVersion(req), allowedSpanId: req.body.allowed_span_id, humanInstruction: req.body.instruction });
    return success(res, { narrative: serializeNarrative(result.narrative), rewritten_span: { span_id: result.rewrittenSpan.spanId, source_claim_ids: result.rewrittenSpan.sourceClaimIds }, reused: result.reused }, req);
  }));
  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}

function normalizeDraftPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw validationError("Report draft payload is required");
  const reportType = body.report_type;
  const periodStart = body.period_start;
  const periodEnd = body.period_end;
  const timezone = body.timezone;
  const contextVersion = body.context_version;
  const metrics = body.metrics;
  const selectedIssuePack = body.selected_issue_pack;
  if (!["harian", "mingguan", "bulanan"].includes(reportType) || !isDate(periodStart) || !isDate(periodEnd) || Date.parse(periodStart) >= Date.parse(periodEnd)
    || typeof timezone !== "string" || !timezone.trim() || !isTimezone(timezone) || !Number.isInteger(contextVersion) || contextVersion < 1
    || !metrics || typeof metrics !== "object" || Array.isArray(metrics) || metrics.period_start !== periodStart || metrics.period_end !== periodEnd
    || !Array.isArray(selectedIssuePack) || selectedIssuePack.length < 1 || selectedIssuePack.length > 20) throw validationError("Report draft requires a valid period and validated issue pack");
  return { reportType, periodStart, periodEnd, timezone, contextVersion, metrics: toCamelMetrics(metrics), selectedIssuePack: selectedIssuePack.map(toCamelIssuePackItem) };
}

function buildDraftCandidate(auth, payload) { return { reportId: "draft-validation", tenantId: auth.tenantId, companyId: auth.companyId, ...payload, reviewStatus: "draft" }; }
function toCamelMetrics(metrics) { const result = { ...metrics }; delete result.period_start; delete result.period_end; return { periodStart: metrics.period_start, periodEnd: metrics.period_end, ...result }; }
function toCamelIssuePackItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw validationError("Report issue pack item is invalid");
  const allowed = ["report_item_id", "issue_id", "analysis_id", "priority", "title", "one_liner", "analysis", "claims", "citations"];
  if (Object.keys(item).some((key) => !allowed.includes(key))) throw validationError("Report draft accepts only validated issue and insight fields");
  if (Object.hasOwn(item, "raw_article_body") || Object.hasOwn(item, "article_body") || Object.hasOwn(item, "content")) throw validationError("Raw article content is not accepted in report drafts");
  return { reportItemId: item.report_item_id, issueId: item.issue_id, analysisId: item.analysis_id, priority: item.priority, title: item.title, oneLiner: item.one_liner, analysis: { whatHappened: item.analysis?.what_happened, whyMatters: item.analysis?.why_matters }, claims: (item.claims || []).map((claim) => ({ claimId: claim.claim_id, text: claim.text, sourceArticleIds: claim.source_article_ids })), citations: (item.citations || []).map((citation) => ({ sourceArticleId: citation.source_article_id, canonicalUrl: citation.canonical_url })) };
}
function serializeDraft(draft) { return { report_id: draft.reportId, report_type: draft.reportType, period_start: draft.periodStart, period_end: draft.periodEnd, timezone: draft.timezone, context_version: draft.contextVersion, metrics: draft.metrics, selected_issue_pack: draft.selectedIssuePack, review_status: draft.reviewStatus, version: draft.version, created_at: draft.createdAt, updated_at: draft.updatedAt }; }
function serializeNarrative(narrative) { return { report_narrative_id: narrative.reportNarrativeId, report_id: narrative.reportId, prompt_version: narrative.promptVersion, narrative: narrative.narrative, review_status: narrative.reviewStatus, version: narrative.version, created_at: narrative.createdAt, updated_at: narrative.updatedAt }; }
function actorScope(req) { return { tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, actor: req.authContext.actor }; }
function readVersion(req) { const header = req.get("If-Match"); const value = header || req.body?.version; const version = Number(value); if (!Number.isInteger(version) || version < 1) throw validationError("A positive report version is required"); return version; }
function nullableNote(value) { return value === undefined ? null : value; }
function isDate(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function isTimezone(value) { try { Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; } }
function validationError(message) { return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 }); }
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, validationError("Idempotency-Key header must be 16 to 255 characters")); return next(); }
function success(res, data, req, statusCode = 200) { return res.status(statusCode).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createReportRouter };
