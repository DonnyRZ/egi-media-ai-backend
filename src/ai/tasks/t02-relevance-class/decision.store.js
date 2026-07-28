const { randomUUID } = require("crypto");
const { branchForDecision } = require("./relevance-policy");

class InMemoryRelevanceDecisionStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid;
    this.now = now;
    this.decisionsByKey = new Map();
    this.decisionsById = new Map();
  }

  get({ tenantId = null, articleId, companyId, contextVersion, inputFingerprint }) {
    const decision = this.decisionsByKey.get(this._key({ tenantId, articleId, companyId, contextVersion, inputFingerprint }));
    return decision ? cloneForRead(decision) : null;
  }

  getById(decisionId) {
    const decision = this.decisionsById.get(decisionId);
    return decision ? cloneForRead(decision) : null;
  }

  getLatest({ tenantId = null, articleId, companyId, contextVersion }) {
    const matches = [...this.decisionsByKey.values()]
      .filter((decision) => (tenantId == null || decision.tenantId === tenantId)
        && decision.articleId === articleId
        && decision.companyId === companyId
        && decision.contextVersion === contextVersion)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return matches[0] ? cloneForRead(matches[0]) : null;
  }

  create({ tenantId = null, articleId, companyId, contextVersion, inputFingerprint, source, output, provenance }) {
    const key = this._key({ tenantId, articleId, companyId, contextVersion, inputFingerprint });
    const existing = this.decisionsByKey.get(key);
    if (existing) return cloneForRead(existing);

    const subjectRelation = output.subject_relation ?? null;
    const competitorOptIn = output.competitor_opt_in === true;
    const decision = {
      decisionId: this.uuid(),
      tenantId,
      articleId,
      companyId,
      contextVersion,
      inputFingerprint,
      relevance: output.relevance,
      confidence: output.confidence,
      subjectRelation,
      competitorOptIn,
      branch: branchForDecision({
        relevance: output.relevance,
        subjectRelation,
        competitorOptIn,
      }),
      source: {
        sourceArticleId: source.sourceArticleId,
        canonicalUrl: source.canonicalUrl,
        requestedLocale: source.requestedLocale,
        contentLocale: source.contentLocale,
        publishedAt: source.article.publishedAt,
        updatedAt: source.article.updatedAt,
      },
      provenance: structuredClone(provenance),
      createdAt: new Date(this.now()).toISOString(),
    };
    this.decisionsByKey.set(key, decision);
    this.decisionsById.set(decision.decisionId, decision);
    return cloneForRead(decision);
  }

  list() {
    return [...this.decisionsByKey.values()].map(cloneForRead);
  }

  _key({ tenantId = null, articleId, companyId, contextVersion, inputFingerprint }) {
    return `${tenantId ? `${tenantId}|` : ""}${articleId}|${companyId}|${contextVersion}|${inputFingerprint}`;
  }
}

function cloneForRead(value) {
  return deepFreeze(structuredClone(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

module.exports = { InMemoryRelevanceDecisionStore };
