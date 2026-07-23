const { createHash, randomUUID } = require("crypto");
const { replaceConstrainedSpan, resolveConstrainedSpan } = require("./report-narrative.spans");

class InMemoryReportNarrativeStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) { this.uuid = uuid; this.now = now; this.narrativesByKey = new Map(); this.narrativesById = new Map(); }
  get({ reportId, promptVersion }) { const value = this.narrativesByKey.get(`${reportId}|${promptVersion}`); return value ? cloneForRead(value) : null; }
  getById({ tenantId, companyId, reportNarrativeId }) { const value = this.narrativesById.get(reportNarrativeId); return value && value.tenantId === tenantId && value.companyId === companyId ? cloneForRead(value) : null; }
  create({ tenantId, companyId, reportId, promptVersion, narrative, provenance }) {
    const key = `${reportId}|${promptVersion}`; const existing = this.narrativesByKey.get(key); if (existing) return cloneForRead(existing);
    const value = { reportNarrativeId: this.uuid(), tenantId, companyId, reportId, promptVersion, narrative: structuredClone(narrative), provenance: structuredClone(provenance), reviewStatus: "draft", version: 1, rewrites: [], createdAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString() };
    this.narrativesByKey.set(key, value); this.narrativesById.set(value.reportNarrativeId, value); return cloneForRead(value);
  }
  applyConstrainedRewrite({ tenantId, companyId, reportNarrativeId, expectedVersion, allowedSpanId, replacementText, actor, humanInstruction, provenance }) {
    const value = this.narrativesById.get(reportNarrativeId);
    if (!value || value.tenantId !== tenantId || value.companyId !== companyId) return null;
    if (!Number.isInteger(expectedVersion) || expectedVersion !== value.version) return { conflict: { expectedVersion, actualVersion: value.version } };
    const span = resolveConstrainedSpan(value.narrative, allowedSpanId);
    if (!span) return null;
    const narrative = replaceConstrainedSpan(value.narrative, span, replacementText);
    if (!narrative) return null;
    const now = new Date(this.now()).toISOString();
    value.narrative = narrative; value.version += 1; value.updatedAt = now;
    value.rewrites.push({ rewriteId: this.uuid(), allowedSpanId, sourceClaimIds: span.sourceClaimIds, actorId: actor.actorId, actorType: actor.actorType, instructionHash: hash(humanInstruction), provenance: structuredClone(provenance), createdAt: now, version: value.version });
    return { narrative: cloneForRead(value) };
  }
  list() { return [...this.narrativesByKey.values()].map(cloneForRead); }
}
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function cloneForRead(value) { return deepFreeze(structuredClone(value)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }
module.exports = { InMemoryReportNarrativeStore };
