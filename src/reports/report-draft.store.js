const { createHash, randomUUID } = require("crypto");

class InMemoryReportDraftStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) { this.uuid = uuid; this.now = now; this.draftsById = new Map(); }
  createDraft({ tenantId, companyId, reportType, periodStart, periodEnd, timezone, contextVersion, metrics, selectedIssuePack }) {
    const value = { reportId: this.uuid(), tenantId, companyId, reportType, periodStart, periodEnd, timezone, contextVersion, metrics: structuredClone(metrics), selectedIssuePack: structuredClone(selectedIssuePack), reviewStatus: "draft", version: 1, activity: [], createdAt: timestamp(this.now), updatedAt: timestamp(this.now) };
    this.draftsById.set(value.reportId, value); return cloneForRead(value);
  }
  get({ tenantId, companyId, reportId }) { const value = this.draftsById.get(reportId); return value && value.tenantId === tenantId && value.companyId === companyId ? cloneForRead(value) : null; }
  markNarrativeInvalid({ tenantId, companyId, reportId, reasonCode }) {
    const value = this.draftsById.get(reportId); if (!value || value.tenantId !== tenantId || value.companyId !== companyId) return null;
    value.reviewStatus = "needs_review"; value.narrativeFailureCode = reasonCode; value.version += 1; value.updatedAt = timestamp(this.now); return cloneForRead(value);
  }

  transition({ tenantId, companyId, reportId, expectedVersion, nextStatus, actor, action, note = null, shareTarget = null }) {
    const value = this.draftsById.get(reportId);
    if (!value || value.tenantId !== tenantId || value.companyId !== companyId) return null;
    if (!Number.isInteger(expectedVersion) || expectedVersion !== value.version) return { conflict: { expectedVersion, actualVersion: value.version } };
    const now = timestamp(this.now);
    value.reviewStatus = nextStatus; value.version += 1; value.updatedAt = now;
    value.activity.push({ action, actorId: actor.actorId, actorType: actor.actorType, note, shareTargetHash: hashShareTarget(shareTarget), at: now, version: value.version });
    return { report: cloneForRead(value) };
  }
}
function timestamp(now) { return new Date(now()).toISOString(); }
function hashShareTarget(shareTarget) { return shareTarget ? createHash("sha256").update(JSON.stringify(shareTarget)).digest("hex") : null; }
function cloneForRead(value) { return deepFreeze(structuredClone(value)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }
module.exports = { InMemoryReportDraftStore };
