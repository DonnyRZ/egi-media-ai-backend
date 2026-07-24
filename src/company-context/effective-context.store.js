const { randomUUID } = require("crypto");

class InMemoryEffectiveCompanyContextStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid;
    this.now = now;
    this.contextsByCompany = new Map();
  }

  getEffective(companyId, tenantId = null) {
    const contexts = this.contextsByCompany.get(scopeKey(tenantId, companyId)) || this.contextsByCompany.get(scopeKey(null, companyId)) || (tenantId == null ? [...this.contextsByCompany.entries()].find(([key]) => key.endsWith(`:${companyId}`))?.[1] : null) || [];
    const effective = contexts.find((context) => context.status === "effective");
    return effective ? cloneForRead(effective) : null;
  }

  getVersion(companyId, version, tenantId = null) {
    const contexts = this.contextsByCompany.get(scopeKey(tenantId, companyId)) || this.contextsByCompany.get(scopeKey(null, companyId)) || (tenantId == null ? [...this.contextsByCompany.entries()].find(([key]) => key.endsWith(`:${companyId}`))?.[1] : null) || [];
    const context = contexts.find((item) => item.version === version);
    return context ? cloneForRead(context) : null;
  }

  activate({ tenantId = null, companyId, fields, fieldSources = [], missingFields = [], source, actorId, draftId = null, changeReason = null, expectedNextVersion }) {
    const contexts = this.contextsByCompany.get(scopeKey(tenantId, companyId)) || [];
    const nextVersion = contexts.length + 1;
    if (expectedNextVersion !== undefined && expectedNextVersion !== nextVersion) {
      return { conflict: { expectedNextVersion, actualNextVersion: nextVersion } };
    }

    const priorEffective = contexts.find((context) => context.status === "effective");
    if (priorEffective) {
      priorEffective.status = "archived";
      priorEffective.archivedAt = this._timestamp();
    }

    const now = this._timestamp();
    const context = {
      contextId: this.uuid(),
      tenantId,
      companyId,
      version: nextVersion,
      status: "effective",
      source,
      draftId,
      fields: structuredClone(fields),
      fieldSources: structuredClone(fieldSources),
      missingFields: structuredClone(missingFields),
      changeReason,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
    };
    contexts.push(context);
    this.contextsByCompany.set(scopeKey(tenantId, companyId), contexts);
    return { context: cloneForRead(context) };
  }

  _timestamp() {
    return new Date(this.now()).toISOString();
  }
}

function scopeKey(tenantId, companyId) { return `${tenantId || "*"}:${companyId}`; }

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

module.exports = { InMemoryEffectiveCompanyContextStore };
