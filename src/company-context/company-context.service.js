const { CONTEXT_FIELDS, SCALAR_FIELDS, normalizeContextFieldsForRead } = require("../ai/tasks/t01-company-context-draft/schema");
const {
  CompanyContextError,
  CompanyContextNotFoundError,
  CompanyContextConflictError,
} = require("./company-context.errors");
const {
  evaluateContextCompleteness,
  allMissingFields,
  incompleteContextError,
  FIELD_REVIEW_STATUSES,
  AI_REVIEW_FIELDS,
  OPTIONAL_FIELDS,
  createManualFieldReview,
  normalizeFieldReview,
} = require("./completeness");

class CompanyContextService {
  constructor({ draftStore, effectiveContextStore, authorize = denyByDefault, managementIdentityService = null }) {
    this.draftStore = draftStore;
    this.effectiveContextStore = effectiveContextStore;
    this.authorize = authorize;
    this.managementIdentityService = managementIdentityService;
  }

  async getDraft({ actor, draftId }) {
    const draft = await this._requireDraft(draftId);
    await this._authorize(actor, draft.tenantId, draft.companyId, "company_context.read");
    return draft;
  }

  async editDraft({ actor, draftId, fields, fieldReview = null, reviewNote = null, expectedRevision }) {
    const current = await this._requireDraft(draftId);
    await this._authorize(actor, current.tenantId, current.companyId, "company_context.draft");
    this._assertRevision(current, expectedRevision);
    this._assertEditable(current);
    const mergedFields = mergeAndValidateFields(current.result.context, fields);
    const mergedReview = mergeAndValidateFieldReview(current.result.field_review, fieldReview, fields, mergedFields);
    const completeness = evaluateContextCompleteness(mergedFields, mergedReview, { legacyEffective: false });

    return this.draftStore.update(draftId, (draft) => ({
      ...draft,
      status: "draft",
      result: { ...draft.result, context: mergedFields, field_review: mergedReview, missing_fields: allMissingFields(mergedFields), completeness },
      review: { ...draft.review, note: normalizeOptionalText(reviewNote, 1000) },
    }));
  }

  /** @deprecated Prefer save fields (PATCH) + activate (POST approve) for roles with company_context.approve. */
  async submitForReview({ actor, draftId, reviewNote = null, expectedRevision }) {
    const current = await this._requireDraft(draftId);
    await this._authorize(actor, current.tenantId, current.companyId, "company_context.review");
    this._assertRevision(current, expectedRevision);
    if (current.status !== "draft") {
      throw new CompanyContextConflictError("Only draft Company Context can be submitted for review", {
        details: { draftId, status: current.status },
      });
    }

    return this.draftStore.update(draftId, (draft) => ({
      ...draft,
      status: "in_review",
      review: {
        ...draft.review,
        submittedBy: actorId(actor),
        submittedAt: new Date().toISOString(),
        note: normalizeOptionalText(reviewNote, 1000),
      },
    }));
  }

  /**
   * Activates draft fields as effective Company Context.
   * Accepts status `draft` or legacy `in_review`. Requires company_context.approve.
   * FE Save (owner path): PATCH fields, then POST approve with the new revision.
   */
  async approveDraft({ actor, draftId, approvalNote = null, expectedRevision }) {
    const current = await this._requireDraft(draftId);
    await this._authorize(actor, current.tenantId, current.companyId, "company_context.approve");
    this._assertRevision(current, expectedRevision);
    if (!["draft", "in_review"].includes(current.status)) {
      throw new CompanyContextConflictError("Only draft or in-review Company Context can be activated", {
        details: { draftId, status: current.status },
      });
    }

    const completeness = evaluateContextCompleteness(current.result.context, current.result.field_review, { legacyEffective: false });
    if (!completeness.complete) {
      throw incompleteContextError(completeness, { companyId: current.companyId });
    }

    const activation = await this.effectiveContextStore.activate({
      tenantId: current.tenantId,
      companyId: current.companyId,
      fields: current.result.context,
      fieldReview: completeness.field_review,
      fieldSources: current.result.field_sources || [],
      missingFields: current.result.missing_fields || [],
      completeness,
      source: "ai_draft",
      actorId: actorId(actor),
      draftId: current.draftId,
      changeReason: normalizeOptionalText(approvalNote, 1000),
    });
    if (activation.conflict) {
      throw new CompanyContextConflictError("Company Context version changed during approval", {
        details: activation.conflict,
      });
    }

    const draft = await this.draftStore.update(draftId, (item) => ({
      ...item,
      status: "approved",
      review: {
        ...item.review,
        approvedBy: actorId(actor),
        approvedAt: new Date().toISOString(),
        note: normalizeOptionalText(approvalNote, 1000) || item.review.note,
      },
    }));

    const managementIdentity = await this._draftIdentityForContext({
      tenantId: activation.context.tenantId,
      companyId: activation.context.companyId,
      contextVersion: activation.context.version,
      fields: activation.context.fields,
    });

    return { draft, effectiveContext: activation.context, managementIdentity };
  }

  async getEffectiveContext({ actor, tenantId = null, companyId }) {
    await this._authorize(actor, tenantId, companyId, "company_context.read");
    const context = await this.effectiveContextStore.getEffective(companyId, tenantId);
    if (!context) {
      throw new CompanyContextNotFoundError("No approved effective Company Context exists", { details: { companyId } });
    }
    return context;
  }

  async getEffectiveContextWithIdentity({ actor, tenantId = null, companyId }) {
    const context = await this.getEffectiveContext({ actor, tenantId, companyId });
    const record = this.managementIdentityService
      ? await this.managementIdentityService.get({
        tenantId: tenantId ?? context.tenantId ?? null,
        companyId,
        contextVersion: context.version,
      })
      : null;
    return { context, managementIdentity: record };
  }

  async clearEffectiveContext({ actor, tenantId = null, companyId }) {
    await this._authorize(actor, tenantId, companyId, "company_context.approve");
    if (typeof this.effectiveContextStore.clearEffective !== "function") {
      throw new CompanyContextError("Effective context clear is not configured", { code: "NOT_READY", statusCode: 503 });
    }
    const result = await this.effectiveContextStore.clearEffective({ tenantId, companyId });
    if (!result.cleared) {
      throw new CompanyContextNotFoundError("No approved effective Company Context exists", { details: { companyId } });
    }
    return result;
  }

  async retryManagementIdentity({ actor, tenantId = null, companyId }) {
    await this._authorize(actor, tenantId, companyId, "company_context.approve");
    if (!this.managementIdentityService) {
      throw new CompanyContextError("Management identity service is not configured", { code: "NOT_READY", statusCode: 503 });
    }
    const context = await this.effectiveContextStore.getEffective(companyId, tenantId);
    if (!context) {
      throw new CompanyContextNotFoundError("No approved effective Company Context exists", { details: { companyId } });
    }
    return this.managementIdentityService.draftAndPersist({
      tenantId: tenantId ?? context.tenantId ?? null,
      companyId,
      contextVersion: context.version,
      fields: context.fields,
      throwOnError: false,
    });
  }

  async getEffectiveFullContext({ actor, tenantId = null, companyId }) {
    const context = await this.getEffectiveContext({ actor, tenantId, companyId });
    if (!this.managementIdentityService) {
      return { context, managementIdentity: null };
    }
    const record = await this.managementIdentityService.get({
      tenantId: tenantId ?? context.tenantId ?? null,
      companyId,
      contextVersion: context.version,
    });
    return { context, managementIdentity: record };
  }

  async replaceEffectiveContext({ actor, tenantId = null, companyId, version, fields, changeReason = null }) {
    // Align with PUT /companies/:id/context route scope (company_context.draft).
    await this._authorize(actor, tenantId, companyId, "company_context.draft");
    const validatedFields = validateFullFields(fields);
    const fieldReview = createManualFieldReview(validatedFields);
    const completeness = evaluateContextCompleteness(validatedFields, fieldReview, { legacyEffective: false });
    if (!completeness.complete) {
      throw incompleteContextError(completeness, { companyId, contextVersion: version });
    }
    const activation = await this.effectiveContextStore.activate({
      tenantId,
      companyId,
      fields: validatedFields,
      fieldReview,
      fieldSources: [],
      missingFields: [],
      completeness,
      source: "manual",
      actorId: actor.id,
      changeReason: normalizeOptionalText(changeReason, 1000),
      expectedNextVersion: version,
    });
    if (activation.conflict) {
      throw new CompanyContextConflictError("Requested Company Context version is not next", {
        details: activation.conflict,
      });
    }

    await this._draftIdentityForContext({
      tenantId: activation.context.tenantId,
      companyId: activation.context.companyId,
      contextVersion: activation.context.version,
      fields: activation.context.fields,
    });

    const managementIdentity = this.managementIdentityService
      ? await this.managementIdentityService.get({
        tenantId: activation.context.tenantId,
        companyId: activation.context.companyId,
        contextVersion: activation.context.version,
      })
      : null;

    return { context: activation.context, managementIdentity };
  }

  async _draftIdentityForContext({ tenantId, companyId, contextVersion, fields }) {
    if (!this.managementIdentityService) return null;
    return this.managementIdentityService.draftAndPersist({
      tenantId,
      companyId,
      contextVersion,
      fields,
      throwOnError: false,
    });
  }

  async _requireDraft(draftId) {
    const draft = await this.draftStore.get(draftId);
    if (!draft) {
      throw new CompanyContextNotFoundError("Company Context draft was not found", { details: { draftId } });
    }
    return draft;
  }

  _assertEditable(draft) {
    if (!["draft", "in_review"].includes(draft.status)) {
      throw new CompanyContextConflictError("Approved Company Context draft cannot be edited", {
        details: { draftId: draft.draftId, status: draft.status },
      });
    }
  }

  _assertRevision(draft, expectedRevision) {
    if (expectedRevision === undefined) return;
    if (!Number.isInteger(expectedRevision) || expectedRevision !== draft.revision) {
      throw new CompanyContextConflictError("Company Context draft revision is stale", {
        details: { draftId: draft.draftId, expectedRevision, actualRevision: draft.revision },
      });
    }
  }

  async _authorize(actor, tenantId, companyId, action) {
    if (!actorId(actor)) {
      throw new CompanyContextError("Authenticated actor is required", { code: "UNAUTHORIZED", statusCode: 401 });
    }
    const granted = await this.authorize({ actor, tenantId, companyId, action });
    if (granted !== true) {
      throw new CompanyContextError("Company Context action was not authorized", { code: "FORBIDDEN", statusCode: 403 });
    }
  }
}

function actorId(actor) {
  return actor?.actorId || actor?.id || actor?.sub || null;
}

function mergeAndValidateFields(currentFields, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new CompanyContextError("Company Context field patch is required", { code: "VALIDATION_ERROR" });
  }
  for (const key of Object.keys(patch)) {
    if (!CONTEXT_FIELDS.includes(key)) {
      throw new CompanyContextError("Company Context patch includes an unsupported field", {
        code: "VALIDATION_ERROR", details: { key },
      });
    }
  }
  return validateFullFields({ ...currentFields, ...patch });
}

function mergeAndValidateFieldReview(currentReview, patch, fieldPatch, mergedFields) {
  const merged = normalizeFieldReview(mergedFields, currentReview, { legacyEffective: false });
  // A field patch from a legacy client represents an explicit manual edit. New
  // clients send field_review alongside the patch; in that case only the
  // explicit review state may confirm an AI proposal.
  if ((patch === null || patch === undefined) && fieldPatch && typeof fieldPatch === "object") {
    for (const field of Object.keys(fieldPatch)) {
      if (CONTEXT_FIELDS.includes(field) && fieldPatch[field] !== undefined) {
        merged[field] = hasValue(mergedFields[field], field) ? "user_confirmed" : (AI_REVIEW_FIELDS.includes(field) || OPTIONAL_FIELDS.includes(field) ? "reviewed_none_disclosed" : "missing");
      }
    }
  }
  if (patch !== null && patch !== undefined) {
    if (typeof patch !== "object" || Array.isArray(patch)) throw new CompanyContextError("Company Context field review must be an object", { code: "VALIDATION_ERROR" });
    for (const [field, status] of Object.entries(patch)) {
      if (!CONTEXT_FIELDS.includes(field) || !FIELD_REVIEW_STATUSES.includes(status)) throw new CompanyContextError("Company Context field review is invalid", { code: "VALIDATION_ERROR", details: { field, status } });
      if (status === "user_confirmed" && !hasValue(mergedFields[field], field)) throw new CompanyContextError("A confirmed Company Context field must contain a value", { code: "VALIDATION_ERROR", details: { field } });
      if (status === "reviewed_none_disclosed" && !AI_REVIEW_FIELDS.includes(field) && !OPTIONAL_FIELDS.includes(field)) throw new CompanyContextError("Required Company Context fields cannot be marked as undisclosed", { code: "VALIDATION_ERROR", details: { field } });
      merged[field] = status;
    }
  }
  return merged;
}

function hasValue(value, field) {
  if (SCALAR_FIELDS.includes(field)) return typeof value === "string" && value.trim().length > 0;
  return Array.isArray(value) && value.length > 0;
}

function validateFullFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new CompanyContextError("Company Context fields must be an object", { code: "VALIDATION_ERROR" });
  }
  if (Object.keys(fields).some((key) => !CONTEXT_FIELDS.includes(key))) {
    throw new CompanyContextError("Company Context includes an unsupported field", { code: "VALIDATION_ERROR" });
  }
  const normalized = {};
  for (const field of CONTEXT_FIELDS) {
    // Legacy effective contexts may omit newly added array fields — default to [].
    const value = fields[field] === undefined && !SCALAR_FIELDS.includes(field) ? [] : fields[field];
    if (SCALAR_FIELDS.includes(field)) {
      if (value !== null && (typeof value !== "string" || value.length > (field === "description" ? 4000 : 255))) {
        throw new CompanyContextError("Company Context scalar field is invalid", { code: "VALIDATION_ERROR", details: { field } });
      }
      normalized[field] = value;
    } else {
      if (!Array.isArray(value) || value.length > 30 || value.some((item) => typeof item !== "string" || !item || item.length > 255)) {
        throw new CompanyContextError("Company Context list field is invalid", { code: "VALIDATION_ERROR", details: { field } });
      }
      normalized[field] = [...value];
    }
  }
  return normalized;
}

function normalizeOptionalText(value, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new CompanyContextError("Review note is invalid", { code: "VALIDATION_ERROR" });
  }
  return value;
}

function denyByDefault() {
  return false;
}

module.exports = { CompanyContextService, validateFullFields, normalizeContextFieldsForRead };
