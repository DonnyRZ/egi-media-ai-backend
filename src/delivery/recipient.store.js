class InMemoryRecipientStore {
  constructor() { this.recipientsByKey = new Map(); }
  get({ tenantId, companyId, recipientId }) { const value = this.recipientsByKey.get(this._key({ tenantId, companyId, recipientId })); return value ? cloneForRead(value) : null; }
  upsert({ tenantId, companyId, recipientId, email }) {
    if (!isEmail(email)) throw new Error("Recipient email is invalid");
    const value = { tenantId, companyId, recipientId, email: email.trim().toLowerCase() };
    this.recipientsByKey.set(this._key(value), value); return cloneForRead(value);
  }
  _key({ tenantId, companyId, recipientId }) { return `${tenantId}|${companyId}|${recipientId}`; }
}
function isEmail(value) { return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
function cloneForRead(value) { return deepFreeze(structuredClone(value)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }
module.exports = { InMemoryRecipientStore, isEmail };
