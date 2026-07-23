class InMemoryAlertPreferenceStore {
  constructor() { this.preferencesByKey = new Map(); }

  get({ tenantId, companyId, recipientId }) {
    const value = this.preferencesByKey.get(this._key({ tenantId, companyId, recipientId }));
    return value ? cloneForRead(value) : null;
  }

  upsert({ tenantId, companyId, recipientId, directHighEnabled, dailyDigestEnabled, timezone, quietHours = null }) {
    const value = { tenantId, companyId, recipientId, directHighEnabled, dailyDigestEnabled, timezone, quietHours: structuredClone(quietHours) };
    this.preferencesByKey.set(this._key(value), value);
    return cloneForRead(value);
  }

  _key({ tenantId, companyId, recipientId }) { return `${tenantId}|${companyId}|${recipientId}`; }
}

function cloneForRead(value) { return deepFreeze(structuredClone(value)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }

module.exports = { InMemoryAlertPreferenceStore };
