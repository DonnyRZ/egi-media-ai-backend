const { randomUUID } = require("crypto");

class InMemorySavedIssueStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid;
    this.now = now;
    this.savedByKey = new Map();
  }

  get({ tenantId, companyId, issueId, actorId }) {
    const value = this.savedByKey.get(this._key({ tenantId, companyId, issueId, actorId }));
    return value ? clone(value) : null;
  }

  save({ tenantId, companyId, issueId, actorId }) {
    const key = this._key({ tenantId, companyId, issueId, actorId });
    const existing = this.savedByKey.get(key);
    if (existing) return { saved: clone(existing), reused: true };
    const value = { savedId: this.uuid(), tenantId, companyId, issueId, actorId, savedAt: new Date(this.now()).toISOString() };
    this.savedByKey.set(key, value);
    return { saved: clone(value), reused: false };
  }
  isSaved({ tenantId, companyId, issueId, actorId }) { return this.savedByKey.has(this._key({ tenantId, companyId, issueId, actorId })); }

  remove({ tenantId, companyId, issueId, actorId }) {
    const key = this._key({ tenantId, companyId, issueId, actorId });
    const existing = this.savedByKey.get(key);
    this.savedByKey.delete(key);
    return { saved: existing ? clone(existing) : null, removed: Boolean(existing) };
  }

  list({ tenantId, companyId, actorId, page = 1, limit = 20 }) {
    const all = [...this.savedByKey.values()].filter((value) => value.tenantId === tenantId && value.companyId === companyId && value.actorId === actorId).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    const offset = (page - 1) * limit;
    return { items: all.slice(offset, offset + limit).map(clone), page, limit, total: all.length };
  }

  _key({ tenantId, companyId, issueId, actorId }) { return `${tenantId}|${companyId}|${actorId}|${issueId}`; }
}

function clone(value) { return structuredClone(value); }
module.exports = { InMemorySavedIssueStore };
