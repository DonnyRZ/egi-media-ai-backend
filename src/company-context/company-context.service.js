const { CONTEXT_FIELDS, SCALAR_FIELDS } = require("../ai/tasks/t01-company-context-draft/schema");
const {
  CompanyContextError,
  CompanyContextNotFoundError,
  CompanyContextConflictError,
} = require("./company-context.errors");

class CompanyContextService {
  constructor({ draftStore, effectiveContextStore, authorize = denyByDefault }) {
    this.draftStore = draftStore;
    this.effectiveContextStore = effectiveContextStore;
    this.authorize = authorize;
  }

  async getDraft({ actor, draftId }) {
    const draft = await this._requireDraft(draftId);
    await this._authorize(actor, draft.tenantId, draft.companyId, "company_context.read");
    return draft;
  }

  async editDraft({ actor, draftId, fields, reviewNote = null, expectedRevision }) {
    const current = await this._requireDraft(draftId);
    await this._authorize(actor, current.tenantId, current.companyId, "company_context.edit");
    this._assertRevision(current, expectedRevision);
    this._assertEditable(current);
    const mergedFields = mergeAndValidateFields(current.result.context, fields);

    return this.draftStore.update(draftId, (draft) => ({
      ...draft,
      status: "draft",
      result: { ...draft.result, context: mergedFields },
      review: { ...draft.review, note: normalizeOptionalText(reviewNote, 1000) },
    }));
  }

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

  async approveDraft({ actor, draftId, approvalNote = null, expectedRevision }) {
    const current = await this._requireDraft(draftId);
    await this._authorize(actor, current.tenantId, current.companyId, "company_context.approve");
    this._assertRevision(current, expectedRevision);
    if (current.status !== "in_review") {
      throw new CompanyContextConflictError("Only Company Context in review can be approved", {
        details: { draftId, status: current.status },
      });
    }

    const activation = await this.effectiveContextStore.activate({
      tenantId: current.tenantId,
      companyId: current.companyId,
      fields: current.result.context,
      fieldSources: current.result.field_sources || [],
      missingFields: current.result.missing_fields || [],
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

    return { draft, effectiveContext: activation.context };
  }

  async getEffectiveContext({ actor, tenantId = null, companyId }) {
    await this._authorize(actor, tenantId, companyId, "company_context.read");
    const context = await this.effectiveContextStore.getEffective(companyId, tenantId);
    if (!context) {
      throw new CompanyContextNotFoundError("No approved effective Company Context exists", { details: { companyId } });
    }
    return context;
  }

  async replaceEffectiveContext({ actor, tenantId = null, companyId, version, fields, changeReason = null }) {
    await this._authorize(actor, tenantId, companyId, "company_context.write");
    const validatedFields = validateFullFields(fields);
    const activation = await this.effectiveContextStore.activate({
      tenantId,
      companyId,
      fields: validatedFields,
      fieldSources: [],
      missingFields: [],
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
    return activation.context;
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

function validateFullFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new CompanyContextError("Company Context fields must be an object", { code: "VALIDATION_ERROR" });
  }
  if (Object.keys(fields).some((key) => !CONTEXT_FIELDS.includes(key))) {
    throw new CompanyContextError("Company Context includes an unsupported field", { code: "VALIDATION_ERROR" });
  }
  const normalized = {};
  for (const field of CONTEXT_FIELDS) {
    const value = fields[field];
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

module.exports = { CompanyContextService, validateFullFields };
