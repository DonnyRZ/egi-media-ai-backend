"use strict";

const { randomUUID } = require("crypto");

/**
 * In-memory store for management identities keyed by company + context version.
 */
class InMemoryManagementIdentityStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid;
    this.now = now;
    this.byKey = new Map();
  }

  get({ tenantId = null, companyId, contextVersion }) {
    const record = this.byKey.get(key(tenantId, companyId, contextVersion));
    return record ? cloneForRead(record) : null;
  }

  upsert({
    tenantId = null,
    companyId,
    contextVersion,
    status,
    identity = null,
    provenance = null,
    errorMessage = null,
  }) {
    const k = key(tenantId, companyId, contextVersion);
    const existing = this.byKey.get(k);
    const now = new Date(this.now()).toISOString();
    const record = {
      identityId: existing?.identityId || this.uuid(),
      tenantId,
      companyId,
      contextVersion,
      status,
      identity: identity ? structuredClone(identity) : existing?.identity || null,
      provenance: provenance ? structuredClone(provenance) : existing?.provenance || null,
      errorMessage: errorMessage ?? null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.byKey.set(k, record);
    return cloneForRead(record);
  }
}

function key(tenantId, companyId, contextVersion) {
  return `${tenantId || "*"}:${companyId}:${contextVersion}`;
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

module.exports = { InMemoryManagementIdentityStore };
