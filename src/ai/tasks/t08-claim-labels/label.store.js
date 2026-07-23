const { randomUUID } = require("crypto");
class InMemoryClaimLabelStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) { this.uuid = uuid; this.now = now; this.labelsByKey = new Map(); }
  get({ analysisId, promptVersion }) { const value = this.labelsByKey.get(this._key({ analysisId, promptVersion })); return value ? cloneForRead(value) : null; }
  create({ tenantId, companyId, analysisId, issueId, promptVersion, labels, provenance }) {
    const key = this._key({ analysisId, promptVersion }); const existing = this.labelsByKey.get(key); if (existing) return cloneForRead(existing);
    const value = { labelRunId: this.uuid(), tenantId, companyId, analysisId, issueId, promptVersion, labels: structuredClone(labels), provenance: structuredClone(provenance), createdAt: new Date(this.now()).toISOString() };
    this.labelsByKey.set(key, value); return cloneForRead(value);
  }
  list() { return [...this.labelsByKey.values()].map(cloneForRead); }
  _key({ analysisId, promptVersion }) { return `${analysisId}|${promptVersion}`; }
}
function cloneForRead(value) { return deepFreeze(structuredClone(value)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }
module.exports = { InMemoryClaimLabelStore };
