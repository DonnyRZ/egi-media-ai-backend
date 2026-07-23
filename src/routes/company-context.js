const express = require("express");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createCompanyContextRouter({ companyContextService, companyContextDraftService, getCompanyContextDraftService } = {}) {
  const router = express.Router();

  router.post("/api/v1/company-context/draft", requireIdempotencyKey, asyncHandler(async (req, res) => {
    const draftService = companyContextDraftService || getCompanyContextDraftService?.();
    if (!draftService?.createDraft) {
      return sendError(res, req, Object.assign(new Error("Company Context draft pipeline is not configured"), { code: "NOT_READY", statusCode: 503 }));
    }
    const companyId = req.authContext?.companyId || req.get("X-Company-Id");
    const tenantId = req.authContext?.tenantId || req.get("X-Tenant-Id");
    const result = await draftService.createDraft({
      trustedContext: {
        tenantId,
        companyId,
        actor: req.user,
        scopeTrusted: req.authContext?.scopeTrusted === true,
        extractionLanguage: req.body?.extraction_language || "id",
        limits: req.body?.limits || {},
      },
      sources: req.body?.source ? [req.body.source] : [],
    });
    res.status(202).json({ success: true, data: { draft: serializeDraft(result.draft), provenance: result.provenance }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
  }));

  router.get("/api/v1/companies/:companyId/context", asyncHandler(async (req, res) => {
    const context = await companyContextService.getEffectiveContext({
      actor: req.user,
      companyId: req.params.companyId,
    });
    success(res, serializeContext(context), req);
  }));

  router.put("/api/v1/companies/:companyId/context", requireIdempotencyKey, requireIfMatch, asyncHandler(async (req, res) => {
    const context = await companyContextService.replaceEffectiveContext({
      actor: req.user,
      companyId: req.params.companyId,
      version: req.body?.version,
      fields: req.body?.fields,
      changeReason: req.body?.change_reason,
    });
    success(res, serializeContext(context), req);
  }));

  router.get("/api/v1/company-context/drafts/:draftId", asyncHandler(async (req, res) => {
    const draft = await companyContextService.getDraft({ actor: req.user, draftId: req.params.draftId });
    success(res, serializeDraft(draft), req);
  }));

  router.patch("/api/v1/company-context/drafts/:draftId", requireIdempotencyKey, asyncHandler(async (req, res) => {
    const draft = await companyContextService.editDraft({
      actor: req.user,
      draftId: req.params.draftId,
      fields: req.body?.fields,
      reviewNote: req.body?.review_note,
      expectedRevision: readExpectedRevision(req),
    });
    success(res, serializeDraft(draft), req);
  }));

  router.post("/api/v1/company-context/drafts/:draftId/submit-review", requireIdempotencyKey, asyncHandler(async (req, res) => {
    const draft = await companyContextService.submitForReview({
      actor: req.user,
      draftId: req.params.draftId,
      reviewNote: req.body?.review_note,
      expectedRevision: readExpectedRevision(req),
    });
    success(res, serializeDraft(draft), req);
  }));

  router.post("/api/v1/company-context/drafts/:draftId/approve", requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await companyContextService.approveDraft({
      actor: req.user,
      draftId: req.params.draftId,
      approvalNote: req.body?.approval_note,
      expectedRevision: readExpectedRevision(req),
    });
    success(res, { draft: serializeDraft(result.draft), effective_context: serializeContext(result.effectiveContext) }, req);
  }));

  router.use((error, req, res, _next) => {
    return sendError(res, req, error);
  });

  return router;
}

function requireIdempotencyKey(req, res, next) {
  const key = req.get("Idempotency-Key");
  if (!key || key.length < 16 || key.length > 255) {
    return sendError(res, req, Object.assign(new Error("Idempotency-Key header must be 16 to 255 characters"), { code: "VALIDATION_ERROR", statusCode: 400 }));
  }
  return next();
}

function requireIfMatch(req, res, next) {
  const header = req.get("If-Match");
  const requestedVersion = req.body?.version;
  const currentVersion = Number(header);
  if (!/^[0-9]+$/.test(header || "") || !Number.isInteger(requestedVersion) || requestedVersion !== currentVersion + 1) {
    return sendError(res, req, Object.assign(new Error("If-Match must reference the previous context version"), { code: "VERSION_CONFLICT", statusCode: 409 }));
  }
  return next();
}

function readExpectedRevision(req) {
  const header = req.get("If-Match");
  if (!header) return undefined;
  if (!/^\d+$/.test(header)) {
    const error = Object.assign(new Error("If-Match must contain the current draft revision"), { code: "VERSION_CONFLICT", statusCode: 409 });
    throw error;
  }
  return Number(header);
}

function success(res, data, req) {
  res.status(200).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function serializeContext(context) {
  return {
    context_id: context.contextId,
    company_id: context.companyId,
    version: context.version,
    status: context.status,
    source: context.source,
    draft_id: context.draftId,
    fields: context.fields,
    change_reason: context.changeReason,
    updated_by: context.updatedBy,
    created_at: context.createdAt,
    updated_at: context.updatedAt,
  };
}

function serializeDraft(draft) {
  return {
    draft_id: draft.draftId,
    company_id: draft.companyId,
    status: draft.status,
    is_effective: draft.isEffective,
    revision: draft.revision,
    result: draft.result,
    review: {
      submitted_by: draft.review.submittedBy,
      submitted_at: draft.review.submittedAt,
      approved_by: draft.review.approvedBy,
      approved_at: draft.review.approvedAt,
      note: draft.review.note,
    },
    created_at: draft.createdAt,
    updated_at: draft.updatedAt,
  };
}

module.exports = { createCompanyContextRouter };
