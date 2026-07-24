class SchedulerStateStore {
  constructor({ now = Date.now } = {}) { this.now = now; this.states = new Map(); this.locks = new Map(); }
  key({ sourceName, locale, tenantId = null, companyId = null }) { return `${sourceName}|${tenantId || "*"}|${companyId || "*"}|${locale}`; }
  get(input) { return this.states.get(this.key(input)) || null; }
  record(input, patch = {}) { const key = this.key(input); const state = { sourceName: input.sourceName, tenantId: input.tenantId || null, companyId: input.companyId || null, locale: input.locale, lastTickAt: new Date(this.now()).toISOString(), ...this.states.get(key), ...patch }; this.states.set(key, state); return structuredClone(state); }
  acquire(input, owner, ttlMs = 300000) { const key = this.key(input); const current = this.locks.get(key); const now = this.now(); if (current && current.expiresAt > now && current.owner !== owner) return false; this.locks.set(key, { owner, acquiredAt: now, expiresAt: now + ttlMs }); return true; }
  release(input, owner) { const key = this.key(input); const current = this.locks.get(key); if (current?.owner === owner) this.locks.delete(key); }
  isLocked(input) { const current = this.locks.get(this.key(input)); return Boolean(current && current.expiresAt > this.now()); }
}
module.exports = { SchedulerStateStore };
