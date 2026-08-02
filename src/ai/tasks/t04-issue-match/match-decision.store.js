const { randomUUID } = require("crypto");

class InMemoryIssueMatchDecisionStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid;
    this.now = now;
    this.decisionsByKey = new Map();
    this.decisionsById = new Map();
  }

  get({ tenantId, companyId, relevanceDecisionId, promptVersion }) {
    const value = this.decisionsByKey.get(this._key({ tenantId, companyId, relevanceDecisionId, promptVersion }));
    return value ? cloneForRead(value) : null;
  }

  getById(matchDecisionId) {
    const value = this.decisionsById.get(matchDecisionId);
    return value ? cloneForRead(value) : null;
  }

  create({ tenantId, companyId, relevanceDecisionId, promptVersion, output, provenance, pipelineId = null, inputFingerprint = null }) {
    const key = this._key({ tenantId, companyId, relevanceDecisionId, promptVersion });
    const existing = this.decisionsByKey.get(key);
    if (existing) return cloneForRead(existing);
    const value = {
      matchDecisionId: this.uuid(), tenantId, companyId, relevanceDecisionId, promptVersion,
      decision: output.decision, candidateIssueId: output.candidate_issue_id, reasonCode: output.reason_code,
      provenance: structuredClone(provenance), pipelineId, inputFingerprint, createdAt: new Date(this.now()).toISOString(),
    };
    this.decisionsByKey.set(key, value);
    this.decisionsById.set(value.matchDecisionId, value);
    return cloneForRead(value);
  }

  list() {
    return [...this.decisionsByKey.values()].map(cloneForRead);
  }

  _key({ tenantId, companyId, relevanceDecisionId, promptVersion }) {
    return `${tenantId}|${companyId}|${relevanceDecisionId}|${promptVersion}`;
  }
}

function cloneForRead(value) {
  return deepFreeze(structuredClone(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

module.exports = { InMemoryIssueMatchDecisionStore };
