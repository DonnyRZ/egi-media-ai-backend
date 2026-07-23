const { randomUUID, createHash } = require("crypto");

class InMemoryEmailDeliveryStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) { this.uuid = uuid; this.now = now; this.deliveriesByEventId = new Map(); }
  getByAlertEventId({ tenantId, companyId, alertEventId }) {
    const delivery = this.deliveriesByEventId.get(alertEventId);
    return delivery && delivery.tenantId === tenantId && delivery.companyId === companyId ? cloneForRead(delivery) : null;
  }
  create({ tenantId, companyId, alertEventId, recipientId, recipientEmail, templateVersion, subject, idempotencyKey }) {
    const existing = this.deliveriesByEventId.get(alertEventId); if (existing) return cloneForRead(existing);
    const value = { deliveryId: this.uuid(), tenantId, companyId, alertEventId, recipientId, recipientEmailHash: hashEmail(recipientEmail), templateVersion, subject, idempotencyKey, status: "queued", attempts: [], providerMessageId: null, createdAt: timestamp(this.now), updatedAt: timestamp(this.now), sentAt: null };
    this.deliveriesByEventId.set(alertEventId, value); return cloneForRead(value);
  }
  recordAttempt({ tenantId, companyId, deliveryId, attempt, outcome, providerMessageId = null, errorCode = null }) {
    const delivery = this._require({ tenantId, companyId, deliveryId });
    delivery.attempts.push({ attempt, outcome, providerMessageId, errorCode, at: timestamp(this.now) }); delivery.updatedAt = timestamp(this.now);
    return cloneForRead(delivery);
  }
  markSent({ tenantId, companyId, deliveryId, providerMessageId }) {
    const delivery = this._require({ tenantId, companyId, deliveryId }); delivery.status = "sent"; delivery.providerMessageId = providerMessageId || null; delivery.sentAt = timestamp(this.now); delivery.updatedAt = timestamp(this.now); return cloneForRead(delivery);
  }
  markFailed({ tenantId, companyId, deliveryId, errorCode }) {
    const delivery = this._require({ tenantId, companyId, deliveryId }); delivery.status = "failed"; delivery.errorCode = errorCode; delivery.updatedAt = timestamp(this.now); return cloneForRead(delivery);
  }
  list() { return [...this.deliveriesByEventId.values()].map(cloneForRead); }
  _require({ tenantId, companyId, deliveryId }) { const delivery = [...this.deliveriesByEventId.values()].find((item) => item.deliveryId === deliveryId && item.tenantId === tenantId && item.companyId === companyId); if (!delivery) throw new Error("Email delivery was not found in scope"); return delivery; }
}
function hashEmail(email) { return createHash("sha256").update(email.trim().toLowerCase()).digest("hex"); }
function timestamp(now) { return new Date(now()).toISOString(); }
function cloneForRead(value) { return deepFreeze(structuredClone(value)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }
module.exports = { InMemoryEmailDeliveryStore, hashEmail };
