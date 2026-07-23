const { randomUUID } = require("crypto");
class InMemoryFeedbackStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) { this.uuid = uuid; this.now = now; this.byKey = new Map(); }
  create({ tenantId, companyId, actorId, targetType, targetId, type, comment, idempotencyKey }) {
    const key = `${tenantId}|${companyId}|${actorId}|${idempotencyKey}`; const existing = this.byKey.get(key);
    if (existing) return { feedback: structuredClone(existing), reused: true };
    const feedback = { id: this.uuid(), tenantId, companyId, actorId, targetType, targetId, type, comment: comment || null, createdAt: new Date(this.now()).toISOString() };
    this.byKey.set(key, feedback); return { feedback: structuredClone(feedback), reused: false };
  }
}
module.exports = { InMemoryFeedbackStore };
