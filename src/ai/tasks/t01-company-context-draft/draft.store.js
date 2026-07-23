const { randomUUID } = require("crypto");

class InMemoryCompanyContextDraftStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid;
    this.now = now;
    this.drafts = new Map();
  }

  create({ companyId, result, sourceFingerprints, provenance }) {
    const createdAt = this._timestamp();
    const draft = {
      draftId: this.uuid(),
      companyId,
      status: "draft",
      isEffective: false,
      revision: 1,
      result: structuredClone(result),
      sourceFingerprints: structuredClone(sourceFingerprints),
      provenance: structuredClone(provenance),
      review: { submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, note: null },
      createdAt,
      updatedAt: createdAt,
    };
    this.drafts.set(draft.draftId, draft);
    return cloneForRead(draft);
  }

  get(draftId) {
    const draft = this.drafts.get(draftId);
    return draft ? cloneForRead(draft) : null;
  }

  update(draftId, updater) {
    const current = this.drafts.get(draftId);
    if (!current) {
      return null;
    }
    const next = updater(structuredClone(current));
    next.updatedAt = this._timestamp();
    next.revision = current.revision + 1;
    this.drafts.set(draftId, next);
    return cloneForRead(next);
  }

  listByCompany(companyId) {
    return [...this.drafts.values()]
      .filter((draft) => draft.companyId === companyId)
      .map(cloneForRead);
  }

  list() {
    return [...this.drafts.values()].map(cloneForRead);
  }

  _timestamp() {
    return new Date(this.now()).toISOString();
  }
}

function cloneForRead(value) {
  return deepFreeze(structuredClone(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}

module.exports = { InMemoryCompanyContextDraftStore };
