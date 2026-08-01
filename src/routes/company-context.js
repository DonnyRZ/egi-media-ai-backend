const express = require("express");
const multer = require("multer");
const { createHash } = require("crypto");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");
const { extractPdfSource } = require("../company-context/pdf-source.service");
const { resolveDraftLanguage } = require("../language/ai-output-language");
const { serializeManagementIdentitySummary } = require("../ai/identity/readiness");

function createCompanyContextRouter({ companyContextService, companyContextDraftService, getCompanyContextDraftService, getCompanyContextUploadStore, getCompanyStore } = {}) {
  const router = express.Router();
  const scope = optionalSaaSScope({ permission: "company_context.read" });
  const draftScope = optionalSaaSScope({ permission: "company_context.draft", humanOnly: true });
  const reviewScope = optionalSaaSScope({ permission: "company_context.review", humanOnly: true });
  const approveScope = optionalSaaSScope({ permission: "company_context.approve", humanOnly: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 10 * 1024 * 1024 }, fileFilter: (_req, file, callback) => callback(null, file.mimetype === "application/pdf" && /\.pdf$/i.test(file.originalname || "")) });
  const uploadRequestStore = getCompanyContextUploadStore?.();

  async function resolveDraftExtractionLanguage(req) {
    const tenantId = req.authContext?.tenantId || req.get("X-Tenant-Id");
    const companyId = req.authContext?.companyId || req.get("X-Company-Id");
    const companyStore = getCompanyStore?.() || req.app?.locals?.getCompanyStore?.() || req.app?.locals?.companyStore;
    const company = companyStore?.get
      ? await companyStore.get({ tenantId, companyId })
      : null;
    return resolveDraftLanguage({
      explicitLanguage: req.body?.extraction_language,
      companyLocale: company?.locale,
    });
  }

  router.post("/api/v1/company-context/draft/pdf", draftScope, requireIdempotencyKey, upload.single("file"), asyncHandler(async (req, res) => {
    const draftService = companyContextDraftService || getCompanyContextDraftService?.();
    if (!draftService?.createDraft) return sendError(res, req, Object.assign(new Error("Company Context draft pipeline is not configured"), { code: "NOT_READY", statusCode: 503 }));
    if (!req.file) return sendError(res, req, Object.assign(new Error("A PDF file is required"), { code: "PDF_FILE_REQUIRED", statusCode: 400 }));
    const tenantId = req.authContext?.tenantId || req.get("X-Tenant-Id");
    const companyId = req.authContext?.companyId || req.get("X-Company-Id");
    const actorId = req.authContext?.actor?.actorId || req.user?.actorId || req.user?.id;
    const idempotencyKey = req.get("Idempotency-Key");
    const requestHash = createHash("sha256").update(req.file.buffer).digest("hex");
    const requestKey = { tenantId, companyId, actorId, idempotencyKey };
    const logger = req.app.locals.logger;
    logger?.info?.("pdf_upload_received", { requestId: getRequestId(req), correlationId: getCorrelationId(req), actorType: req.authContext?.actor?.actorType || null, tenantId, companyId, fileName: req.file.originalname, mimeType: req.file.mimetype, byteSize: req.file.size, fileHash: requestHash.slice(0, 16) });
    const existing = await uploadRequestStore?.get?.(requestKey);
    if (existing) {
      if (existing.requestHash !== requestHash) throw Object.assign(new Error("Idempotency-Key was already used with a different PDF"), { code: "IDEMPOTENCY_CONFLICT", statusCode: 409 });
      if (existing.status === "completed" && existing.response) return res.status(202).json(existing.response);
      throw Object.assign(new Error("An upload with this Idempotency-Key is already in progress or has failed"), { code: "IDEMPOTENCY_CONFLICT", statusCode: 409 });
    }
    await uploadRequestStore?.createPending?.({ ...requestKey, requestHash });
    try {
      const source = await extractPdfSource(req.file, { maxBytes: 10 * 1024 * 1024, maxPages: 50, maxCharacters: 100000 });
      logger?.info?.("pdf_extraction_succeeded", { requestId: getRequestId(req), correlationId: getCorrelationId(req), tenantId, companyId, sourceLocator: source.sourceLocator, pageCount: source.metadata.pageCount, extractedCharacters: source.text.length, fileHash: requestHash.slice(0, 16) });
      const extractionLanguage = await resolveDraftExtractionLanguage(req);
      const result = await draftService.createDraft({ tenantId, trustedContext: { tenantId, companyId, actor: req.authContext?.actor || req.user, scopeTrusted: req.authContext?.scopeTrusted === true, extractionLanguage, limits: { maxSources: 1, maxCharsPerSource: 100000, maxTotalChars: 100000 } }, sources: [source] });
      const response = { success: true, data: { draft: serializeDraft(result.draft), provenance: result.provenance, source: source.metadata }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } };
      await uploadRequestStore?.complete?.(requestKey, response);
      await req.app.locals.accessAuditStore?.record?.({ actorId, actorType: req.authContext?.actor?.actorType || "human", tenantId, companyId, action: "company_context.pdf_upload", outcome: "allowed", metadata: { requestHash, sourceLocator: source.sourceLocator, status: "completed" } });
      return res.status(202).json(response);
    } catch (error) {
      logger?.error?.("pdf_upload_failed", { requestId: getRequestId(req), correlationId: getCorrelationId(req), actorType: req.authContext?.actor?.actorType || null, tenantId, companyId, fileHash: requestHash.slice(0, 16), error });
      await uploadRequestStore?.fail?.(requestKey, error);
      await req.app.locals.accessAuditStore?.record?.({ actorId, actorType: req.authContext?.actor?.actorType || "human", tenantId, companyId, action: "company_context.pdf_upload", outcome: "denied", metadata: { requestHash, status: "failed", code: error.code || "UPLOAD_FAILED" } });
      throw error;
    }
  }));

  router.post("/api/v1/company-context/draft", draftScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const draftService = companyContextDraftService || getCompanyContextDraftService?.();
    if (!draftService?.createDraft) {
      return sendError(res, req, Object.assign(new Error("Company Context draft pipeline is not configured"), { code: "NOT_READY", statusCode: 503 }));
    }
    const companyId = req.authContext?.companyId || req.get("X-Company-Id");
    const tenantId = req.authContext?.tenantId || req.get("X-Tenant-Id");
    const extractionLanguage = await resolveDraftExtractionLanguage(req);
    const result = await draftService.createDraft({
      tenantId,
      trustedContext: {
        tenantId,
        companyId,
        actor: req.authContext?.actor || req.user,
        scopeTrusted: req.authContext?.scopeTrusted === true,
        extractionLanguage,
        limits: req.body?.limits || { maxSources: 1, maxCharsPerSource: 100000, maxTotalChars: 100000 },
      },
      sources: req.body?.source ? [normalizeSource(req.body.source)] : [],
    });
    res.status(202).json({ success: true, data: { draft: serializeDraft(result.draft), provenance: result.provenance }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
  }));

  router.get("/api/v1/companies/:companyId/context", scope, asyncHandler(async (req, res) => {
    const { context, managementIdentity } = await companyContextService.getEffectiveContextWithIdentity({
      actor: req.authContext?.actor || req.user,
      tenantId: req.authContext?.tenantId || null,
      companyId: req.params.companyId,
    });
    success(res, serializeContext(context, managementIdentity), req);
  }));

  router.put("/api/v1/companies/:companyId/context", draftScope, requireIdempotencyKey, requireIfMatch, asyncHandler(async (req, res) => {
    const result = await companyContextService.replaceEffectiveContext({
      actor: req.authContext?.actor || req.user,
      tenantId: req.authContext?.tenantId || null,
      companyId: req.params.companyId,
      version: req.body?.version,
      fields: req.body?.fields,
      fieldReview: req.body?.field_review,
      changeReason: req.body?.change_reason,
    });
    success(res, serializeContext(result.context, result.managementIdentity), req);
  }));

  router.delete("/api/v1/companies/:companyId/context", approveScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await companyContextService.clearEffectiveContext({
      actor: req.authContext?.actor || req.user,
      tenantId: req.authContext?.tenantId || null,
      companyId: req.params.companyId,
    });
    success(res, {
      cleared: true,
      archived_version: result.context?.version ?? null,
      company_id: req.params.companyId,
    }, req);
  }));

  router.post("/api/v1/companies/:companyId/context/management-identity/retry", approveScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const record = await companyContextService.retryManagementIdentity({
      actor: req.authContext?.actor || req.user,
      tenantId: req.authContext?.tenantId || null,
      companyId: req.params.companyId,
    });
    success(res, {
      management_identity: serializeManagementIdentitySummary(record, {
        contextVersion: record.contextVersion,
      }),
    }, req);
  }));

  router.get("/api/v1/company-context/drafts/:draftId", scope, asyncHandler(async (req, res) => {
    const draft = await companyContextService.getDraft({ actor: req.authContext?.actor || req.user, draftId: req.params.draftId });
    success(res, serializeDraft(draft), req);
  }));

  router.patch("/api/v1/company-context/drafts/:draftId", draftScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const draft = await companyContextService.editDraft({
      actor: req.authContext?.actor || req.user,
      draftId: req.params.draftId,
      fields: req.body?.fields,
      reviewNote: req.body?.review_note,
      expectedRevision: readExpectedRevision(req),
    });
    success(res, serializeDraft(draft), req);
  }));

  router.post("/api/v1/company-context/drafts/:draftId/submit-review", reviewScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const draft = await companyContextService.submitForReview({
      actor: req.authContext?.actor || req.user,
      draftId: req.params.draftId,
      reviewNote: req.body?.review_note,
      expectedRevision: readExpectedRevision(req),
    });
    success(res, serializeDraft(draft), req);
  }));

  router.post("/api/v1/company-context/drafts/:draftId/approve", approveScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await companyContextService.approveDraft({
      actor: req.authContext?.actor || req.user,
      draftId: req.params.draftId,
      approvalNote: req.body?.approval_note,
      expectedRevision: readExpectedRevision(req),
    });
    success(res, {
      draft: serializeDraft(result.draft),
      effective_context: serializeContext(result.effectiveContext, result.managementIdentity),
      management_identity: serializeManagementIdentitySummary(result.managementIdentity, {
        contextVersion: result.effectiveContext?.version,
      }),
    }, req);
  }));

  router.use((error, req, res, _next) => {
    return sendError(res, req, error);
  });

  return router;
}

function normalizeSource(source) {
  if (source?.type === "text" && typeof source.text === "string") {
    return { sourceLocator: `request-text-${digest(source.text)}`, sourceType: "paste", text: source.text };
  }
  if (source?.type === "url" && typeof source.url === "string") {
    return { sourceLocator: `request-url-${digest(source.url)}`, sourceType: "url", sourceUrl: source.url, text: source.url };
  }
  return source;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function optionalSaaSScope(options) {
  const guard = requireAuthContext({ tenant: true, company: true, trustedScope: true, ...options });
  return (req, res, next) => req.app?.locals?.authorizationService ? guard(req, res, next) : next();
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

function serializeContext(context, managementIdentity = undefined) {
  const payload = {
    context_id: context.contextId,
    company_id: context.companyId,
    version: context.version,
    status: context.status,
    source: context.source,
    draft_id: context.draftId,
    fields: context.fields,
    field_sources: context.fieldSources || [],
    field_review: context.fieldReview || null,
    missing_fields: context.missingFields || [],
    completeness: context.completeness || null,
    change_reason: context.changeReason,
    updated_by: context.updatedBy,
    created_at: context.createdAt,
    updated_at: context.updatedAt,
  };
  if (managementIdentity !== undefined) {
    payload.management_identity = serializeManagementIdentitySummary(managementIdentity, {
      contextVersion: context.version,
    });
  }
  return payload;
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
