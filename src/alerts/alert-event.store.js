const { randomUUID } = require("crypto");

class InMemoryAlertEventStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid;
    this.now = now;
    this.eventsById = new Map();
    this.eligibleEventIdByDedupeKey = new Map();
  }

  findEligibleByDedupeKey(dedupeKey) {
    const eventId = this.eligibleEventIdByDedupeKey.get(dedupeKey);
    const event = eventId ? this.eventsById.get(eventId) : null;
    return event ? cloneForRead(event) : null;
  }

  get({ tenantId, companyId, alertEventId }) {
    const event = this.eventsById.get(alertEventId);
    return event && event.tenantId === tenantId && event.companyId === companyId ? cloneForRead(event) : null;
  }

  markContentBlocked({ tenantId, companyId, alertEventId, reasonCode }) {
    const event = this.eventsById.get(alertEventId);
    if (!event || event.tenantId !== tenantId || event.companyId !== companyId) return null;
    event.status = "blocked_invalid_content";
    event.reasonCode = reasonCode;
    event.contentBlockedAt = new Date(this.now()).toISOString();
    return cloneForRead(event);
  }

  markDeliveryBlocked({ tenantId, companyId, alertEventId, reasonCode }) {
    const event = this.eventsById.get(alertEventId);
    if (!event || event.tenantId !== tenantId || event.companyId !== companyId) return null;
    event.status = "blocked_delivery_fields";
    event.reasonCode = reasonCode;
    event.deliveryBlockedAt = new Date(this.now()).toISOString();
    return cloneForRead(event);
  }

  create({ tenantId, companyId, issueId, developmentId, recipientId, channel, status, reasonCode, dedupeKey }) {
    const value = {
      alertEventId: this.uuid(), tenantId, companyId, issueId, developmentId, recipientId,
      channel, status, reasonCode, dedupeKey, read: false, readAt: null, createdAt: new Date(this.now()).toISOString(),
    };
    this.eventsById.set(value.alertEventId, value);
    if (status === "eligible") this.eligibleEventIdByDedupeKey.set(dedupeKey, value.alertEventId);
    return cloneForRead(value);
  }

  list() { return [...this.eventsById.values()].map(cloneForRead); }
  listScoped({ tenantId, companyId, recipientId = null, page = 1, limit = 20 }) {
    const all = [...this.eventsById.values()].filter((event) => event.tenantId === tenantId && event.companyId === companyId && (!recipientId || event.recipientId === recipientId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = (page - 1) * limit;
    return { items: all.slice(offset, offset + limit).map(cloneForRead), page, limit, total: all.length };
  }
  markRead({ tenantId, companyId, alertEventId, read = true }) {
    const event = this.eventsById.get(alertEventId);
    if (!event || event.tenantId !== tenantId || event.companyId !== companyId) return null;
    event.read = read; event.readAt = read ? new Date(this.now()).toISOString() : null;
    return cloneForRead(event);
  }
}

function cloneForRead(value) { return deepFreeze(structuredClone(value)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }

module.exports = { InMemoryAlertEventStore };
