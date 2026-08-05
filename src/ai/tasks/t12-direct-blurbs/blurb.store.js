const { randomUUID } = require("crypto");

class InMemoryDirectAlertBlurbStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) { this.uuid = uuid; this.now = now; this.blurbsByKey = new Map(); }
  get({ alertEventId, promptVersion }) { const value = this.blurbsByKey.get(this._key({ alertEventId, promptVersion })); return value ? cloneForRead(value) : null; }
  listByAlertEventIds({ tenantId, companyId, alertEventIds, promptVersion }) {
    const ids = new Set(Array.isArray(alertEventIds) ? alertEventIds : []);
    return [...this.blurbsByKey.values()]
      .filter((value) => value.tenantId === tenantId && value.companyId === companyId && value.promptVersion === promptVersion && ids.has(value.alertEventId))
      .map(cloneForRead);
  }
  create({ tenantId, companyId, issueId, developmentId, alertEventId, promptVersion, newDevelopmentBlurb, shortImpactBlurb, sourceClaimIds, provenance, pipelineId = null, inputFingerprint = null }) {
    const key = this._key({ alertEventId, promptVersion }); const existing = this.blurbsByKey.get(key); if (existing) return cloneForRead(existing);
    const value = { directBlurbId: this.uuid(), tenantId, companyId, issueId, developmentId, alertEventId, promptVersion, newDevelopmentBlurb, shortImpactBlurb, sourceClaimIds: structuredClone(sourceClaimIds), provenance: structuredClone(provenance), pipelineId, inputFingerprint, createdAt: new Date(this.now()).toISOString() };
    this.blurbsByKey.set(key, value); return cloneForRead(value);
  }
  list() { return [...this.blurbsByKey.values()].map(cloneForRead); }
  _key({ alertEventId, promptVersion }) { return `${alertEventId}|${promptVersion}`; }
}
function cloneForRead(value) { return deepFreeze(structuredClone(value)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }
module.exports = { InMemoryDirectAlertBlurbStore };
