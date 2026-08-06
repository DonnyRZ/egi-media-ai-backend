const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createIssueFormationRouter({ getT04Service, getIssueMutationService, getT05Service, getT06Service, getSavedIssueStore, getIssueReadService, getIssueStore } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "issue.read" });
  const saveScope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "issue.save", humanOnly: true });
  const completeScope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "issue.complete", humanOnly: true });
  const pipelineScope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "ai.pipeline.run" });

  router.get("/api/v1/saved/issues", scope, asyncHandler(async (req, res) => {
    const page = positiveInt(req.query.page, 1); const limit = boundedInt(req.query.limit, 20, 100);
    const saved = await getSavedIssueStore().list({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, actorId: req.authContext.actor.actorId, page, limit });
    const items = [];
    for (const item of saved.items) {
      const serialized = serializeSaved(item);
      if (!serialized) continue;
      try {
        const detail = await readIssue(getIssueReadService(), req, item.issueId);
        items.push({ ...serialized, issue: cardFromDetail(detail) });
      } catch (error) {
        // Skip orphaned bookmarks so one missing issue does not 404 the whole list.
        if (error?.code === "NOT_FOUND" || error?.statusCode === 404) continue;
        throw error;
      }
    }
    return success(res, { items, meta: { page: saved.page, limit: saved.limit, total: saved.total } }, req);
  }));

  router.get("/api/v1/issues/:issueId/saved", scope, asyncHandler(async (req, res) => {
    const issue = await readIssue(getIssueReadService(), req, req.params.issueId);
    const saved = typeof getSavedIssueStore().isSaved === "function" && await getSavedIssueStore().isSaved({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, issueId: issue.issue_id, actorId: req.authContext.actor.actorId });
    return success(res, { saved: Boolean(saved) }, req);
  }));

  router.post("/api/v1/issues/:issueId/saved", saveScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const issue = await readIssue(getIssueReadService(), req, req.params.issueId);
    const result = await getSavedIssueStore().save({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, issueId: issue.issue_id, actorId: req.authContext.actor.actorId });
    return success(res, { saved: serializeSaved(result.saved), issue, reused: result.reused }, req, result.reused ? 200 : 201);
  }));

  router.delete("/api/v1/issues/:issueId/saved", saveScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const issue = await readIssue(getIssueReadService(), req, req.params.issueId);
    const result = await getSavedIssueStore().remove({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, issueId: issue.issue_id, actorId: req.authContext.actor.actorId });
    return success(res, { removed: result.removed, issue_id: issue.issue_id }, req);
  }));

  router.post("/api/v1/issues/:issueId/complete", completeScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (req.authContext.actor?.actorType !== "human") throw Object.assign(new Error("Completing an issue requires a human actor"), { code: "FORBIDDEN", statusCode: 403 });
    const result = await getIssueStore().complete({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, issueId: req.params.issueId, expectedVersion: req.body?.version, idempotencyKey: req.get("Idempotency-Key") });
    return success(res, { issue: serializeIssue(result.issue), reused: result.reused }, req);
  }));

  router.post("/api/v1/internal/issues/match", pipelineScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const context = bodyScope(req);
    const result = await getT04Service().match({ ...context, relevanceDecisionId: req.body?.relevance_decision_id });
    return success(res, { match: result.match, relevance_decision_id: result.relevanceDecision.decisionId, reused: result.reused }, req);
  }));

  router.post("/api/v1/internal/issues/form", pipelineScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const context = bodyScope(req);
    const result = await getIssueMutationService().apply({ ...context, matchDecisionId: req.body?.match_decision_id });
    return success(res, { mutation: result.mutation, reused: result.reused }, req);
  }));

  router.post("/api/v1/internal/issues/:issueId/title", pipelineScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getT05Service().generate({ ...authScope(req), issueId: req.params.issueId });
    return success(res, { title: result.title, issue: result.issue, reused: result.reused }, req);
  }));

  router.post("/api/v1/internal/issues/:issueId/one-liner", pipelineScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
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
function success(res, data, req, statusCode = 200) { return res.status(statusCode).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function readIssue(service, req, issueId) { return service.detail({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, issueId }); }
function serializeSaved(value) { return value ? { saved_id: value.savedId, issue_id: value.issueId, saved_at: value.savedAt } : null; }
function cardFromDetail(detail) {
  if (!detail) return null;
  return {
    issue_id: detail.issue_id,
    title: detail.title,
    one_liner: detail.one_liner ?? null,
    status: detail.status,
    priority: cardPriority(detail),
    first_seen_at: detail.first_seen_at,
    last_developed_at: detail.last_developed_at ?? null,
    version: detail.version,
  };
}
/** Issue detail overwrites card.priority with the priority-decision object; unwrap to a label string. */
function cardPriority(detail) {
  const value = detail?.priority;
  if (typeof value === "string" && ["tinggi", "sedang", "rendah"].includes(value)) return value;
  if (value && typeof value === "object" && typeof value.priority === "string" && ["tinggi", "sedang", "rendah"].includes(value.priority)) {
    return value.priority;
  }
  return null;
}
function serializeIssue(issue) { return { issue_id: issue.issueId, title: issue.title, one_liner: issue.oneLiner, status: issue.status, priority: issue.currentPriority, version: issue.version, first_seen_at: issue.firstSeenAt, last_developed_at: issue.lastDevelopedAt }; }
function positiveInt(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function boundedInt(value, fallback, max) { return Math.min(positiveInt(value, fallback), max); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createIssueFormationRouter };
