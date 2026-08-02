const { randomUUID } = require("crypto");

class InMemoryIssueAnalysisStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid; this.now = now; this.analysesByKey = new Map(); this.analysesById = new Map(); this.currentAnalysisIdByIssue = new Map();
  }

  get({ tenantId, companyId, issueId, inputFingerprint, promptVersion }) {
    const analysis = this.analysesByKey.get(this._key({ tenantId, companyId, issueId, inputFingerprint, promptVersion }));
    return analysis ? cloneForRead(analysis) : null;
  }

  getById(analysisId) {
    const analysis = this.analysesById.get(analysisId);
    return analysis ? cloneForRead(analysis) : null;
  }

  getCurrent({ tenantId, companyId, issueId }) {
    const analysisId = this.currentAnalysisIdByIssue.get(this._currentKey({ tenantId, companyId, issueId }));
    const analysis = analysisId ? this.analysesById.get(analysisId) : null;
    return analysis ? cloneForRead(analysis) : null;
  }

  promoteCurrent({ tenantId, companyId, analysisId, gate }) {
    const analysis = this.analysesById.get(analysisId);
    if (!analysis || analysis.tenantId !== tenantId || analysis.companyId !== companyId || analysis.status !== "validated") {
      throw new Error("Analysis cannot be promoted as current");
    }
    const key = this._currentKey({ tenantId, companyId, issueId: analysis.issueId });
    const priorId = this.currentAnalysisIdByIssue.get(key);
    if (priorId && priorId !== analysisId) {
      const prior = this.analysesById.get(priorId);
      if (prior?.status === "current") prior.status = "superseded";
    }
    analysis.status = "current";
    analysis.validatedAt = new Date(this.now()).toISOString();
    analysis.gate = structuredClone(gate);
    this.currentAnalysisIdByIssue.set(key, analysisId);
    return cloneForRead(analysis);
  }

  create({ tenantId, companyId, issueId, contextVersion, inputFingerprint, promptVersion, analysis, evidence, provenance, pipelineId = null }) {
    const key = this._key({ tenantId, companyId, issueId, inputFingerprint, promptVersion });
    const existing = this.analysesByKey.get(key);
    if (existing) return cloneForRead(existing);
    const value = {
      analysisId: this.uuid(), tenantId, companyId, issueId, contextVersion, inputFingerprint, promptVersion,
      pipelineId,
      status: "validated", analysis: structuredClone(analysis),
      evidence: evidence.map((item) => ({ sourceArticleId: item.sourceArticleId, locale: item.requestedLocale, canonicalUrl: item.canonicalUrl, updatedAt: item.article.updatedAt })),
      provenance: structuredClone(provenance), createdAt: new Date(this.now()).toISOString(),
    };
    this.analysesByKey.set(key, value);
    this.analysesById.set(value.analysisId, value);
    return cloneForRead(value);
  }

  list({ issueId } = {}) { return [...this.analysesByKey.values()].filter((item) => !issueId || item.issueId === issueId).map(cloneForRead); }
  _key({ tenantId, companyId, issueId, inputFingerprint, promptVersion }) { return `${tenantId}|${companyId}|${issueId}|${inputFingerprint}|${promptVersion}`; }
  _currentKey({ tenantId, companyId, issueId }) { return `${tenantId}|${companyId}|${issueId}`; }
}

function cloneForRead(value) { return deepFreeze(structuredClone(value)); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }

module.exports = { InMemoryIssueAnalysisStore };
