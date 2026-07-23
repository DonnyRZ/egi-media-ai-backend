const { randomUUID } = require("crypto");

class InMemoryPriorityReasonStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid;
    this.now = now;
    this.reasonsByKey = new Map();
  }

  get({ priorityDecisionId, promptVersion }) {
    const value = this.reasonsByKey.get(this._key({ priorityDecisionId, promptVersion }));
    return value ? cloneForRead(value) : null;
  }

  create({ tenantId, companyId, issueId, analysisId, priorityDecisionId, promptVersion, reason, sourceClaimIds, provenance }) {
    const key = this._key({ priorityDecisionId, promptVersion });
    const existing = this.reasonsByKey.get(key);
    if (existing) return cloneForRead(existing);
    const value = {
      priorityReasonId: this.uuid(), tenantId, companyId, issueId, analysisId, priorityDecisionId,
      promptVersion, reason, sourceClaimIds: structuredClone(sourceClaimIds), provenance: structuredClone(provenance), createdAt: new Date(this.now()).toISOString(),
    };
    this.reasonsByKey.set(key, value);
    return cloneForRead(value);
  }

  list({ issueId } = {}) { return [...this.reasonsByKey.values()].filter((item) => !issueId || item.issueId === issueId).map(cloneForRead); }
  _key({ priorityDecisionId, promptVersion }) { return `${priorityDecisionId}|${promptVersion}`; }
}

function cloneForRead(value) { return deepFreeze(structuredClone(value)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }

module.exports = { InMemoryPriorityReasonStore };
