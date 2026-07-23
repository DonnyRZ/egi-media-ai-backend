const { randomUUID } = require("crypto");

class InMemoryRelevanceRationaleStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid;
    this.now = now;
    this.rationalesByKey = new Map();
  }

  get({ decisionId, promptVersion }) {
    const rationale = this.rationalesByKey.get(this._key({ decisionId, promptVersion }));
    return rationale ? cloneForRead(rationale) : null;
  }

  create({ decisionId, companyId, promptVersion, rationale, provenance }) {
    const key = this._key({ decisionId, promptVersion });
    const existing = this.rationalesByKey.get(key);
    if (existing) return cloneForRead(existing);
    const value = {
      rationaleId: this.uuid(), decisionId, companyId, promptVersion, rationale,
      provenance: structuredClone(provenance), createdAt: new Date(this.now()).toISOString(),
    };
    this.rationalesByKey.set(key, value);
    return cloneForRead(value);
  }

  list() {
    return [...this.rationalesByKey.values()].map(cloneForRead);
  }

  _key({ decisionId, promptVersion }) {
    return `${decisionId}|${promptVersion}`;
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

module.exports = { InMemoryRelevanceRationaleStore };
