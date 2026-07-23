const { randomUUID } = require("crypto");

class InMemoryIssuePriorityStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid;
    this.now = now;
    this.prioritiesByKey = new Map();
  }

  get({ tenantId, companyId, issueId, analysisId, promptVersion }) {
    const value = this.prioritiesByKey.get(this._key({ tenantId, companyId, issueId, analysisId, promptVersion }));
    return value ? cloneForRead(value) : null;
  }

  create({ tenantId, companyId, issueId, analysisId, contextVersion, promptVersion, priority, provenance }) {
    const key = this._key({ tenantId, companyId, issueId, analysisId, promptVersion });
    const existing = this.prioritiesByKey.get(key);
    if (existing) return cloneForRead(existing);
    const value = {
      priorityDecisionId: this.uuid(), tenantId, companyId, issueId, analysisId, contextVersion,
      promptVersion, priority, provenance: structuredClone(provenance), effectiveAt: new Date(this.now()).toISOString(),
    };
    this.prioritiesByKey.set(key, value);
    return cloneForRead(value);
  }

  list({ issueId } = {}) {
    return [...this.prioritiesByKey.values()].filter((item) => !issueId || item.issueId === issueId).map(cloneForRead);
  }

  _key({ tenantId, companyId, issueId, analysisId, promptVersion }) {
    return `${tenantId}|${companyId}|${issueId}|${analysisId}|${promptVersion}`;
  }
}

function cloneForRead(value) { return deepFreeze(structuredClone(value)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }

module.exports = { InMemoryIssuePriorityStore };
