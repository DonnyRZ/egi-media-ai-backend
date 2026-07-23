const express = require("express");
const { randomUUID } = require("crypto");

function createCompanyContextRouter({ companyContextService }) {
  const router = express.Router();

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
    });
    success(res, serializeDraft(draft), req);
  }));

  router.post("/api/v1/company-context/drafts/:draftId/submit-review", requireIdempotencyKey, asyncHandler(async (req, res) => {
    const draft = await companyContextService.submitForReview({
      actor: req.user,
      draftId: req.params.draftId,
      reviewNote: req.body?.review_note,
    });
    success(res, serializeDraft(draft), req);
  }));

  router.post("/api/v1/company-context/drafts/:draftId/approve", requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await companyContextService.approveDraft({
      actor: req.user,
      draftId: req.params.draftId,
      approvalNote: req.body?.approval_note,
    });
    success(res, { draft: serializeDraft(result.draft), effective_context: serializeContext(result.effectiveContext) }, req);
  }));

  router.use((error, req, res, _next) => {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: {
        code: error.code || "INTERNAL_ERROR",
        message: statusCode === 500 ? "Internal server error" : error.message,
      },
      meta: { request_id: getRequestId(req) },
    });
  });

  return router;
}

function requireIdempotencyKey(req, res, next) {
  const key = req.get("Idempotency-Key");
  if (!key || key.length < 16 || key.length > 255) {
    return res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Idempotency-Key header must be 16 to 255 characters" },
      meta: { request_id: getRequestId(req) },
    });
  }
  return next();
}

function requireIfMatch(req, res, next) {
  const header = req.get("If-Match");
  const requestedVersion = req.body?.version;
  const currentVersion = Number(header);
  if (!/^[0-9]+$/.test(header || "") || !Number.isInteger(requestedVersion) || requestedVersion !== currentVersion + 1) {
    return res.status(409).json({
      success: false,
      error: { code: "VERSION_CONFLICT", message: "If-Match must reference the previous context version" },
      meta: { request_id: getRequestId(req) },
    });
  }
  return next();
}

function success(res, data, req) {
  res.status(200).json({ success: true, data, meta: { request_id: getRequestId(req) } });
}

function getRequestId(req) {
  return req.get("X-Request-Id") || randomUUID();
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
