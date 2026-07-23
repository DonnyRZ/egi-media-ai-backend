const { randomUUID } = require("crypto");
const { AiConfigurationError } = require("../ai/provider/provider.errors");

const ACTIVE_ISSUE_STATUSES = new Set(["baru", "berkembang", "dipantau"]);

class InMemoryIssueStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) {
    this.uuid = uuid;
    this.now = now;
    this.issuesById = new Map();
    this.issueArticlesByKey = new Map();
    this.developmentsById = new Map();
    this.mutationsByMatchDecisionId = new Map();
    this.titleGenerationsByKey = new Map();
    this.oneLinerGenerationsByKey = new Map();
    this.currentPriorityApplicationsByKey = new Map();
    this.completionsByKey = new Map();
  }

  listActive({ tenantId, companyId }) {
    return [...this.issuesById.values()]
      .filter((issue) => issue.tenantId === tenantId && issue.companyId === companyId && ACTIVE_ISSUE_STATUSES.has(issue.status))
      .map(cloneForRead);
  }

  listScoped({ tenantId, companyId }) {
    return [...this.issuesById.values()]
      .filter((issue) => issue.tenantId === tenantId && issue.companyId === companyId)
      .map(cloneForRead);
  }

  seed(issue) {
    if (!issue || typeof issue !== "object" || typeof issue.issueId !== "string"
      || typeof issue.tenantId !== "string" || typeof issue.companyId !== "string"
      || ![...ACTIVE_ISSUE_STATUSES, "selesai"].includes(issue.status)
      || !Number.isInteger(issue.version)) {
      throw new AiConfigurationError("Issue store received an invalid seed issue");
    }
    this.issuesById.set(issue.issueId, structuredClone(issue));
  }

  getIssue({ tenantId, companyId, issueId }) {
    const issue = this.issuesById.get(issueId);
    return issue && issue.tenantId === tenantId && issue.companyId === companyId ? cloneForRead(issue) : null;
  }

  getMutation(matchDecisionId) {
    const mutation = this.mutationsByMatchDecisionId.get(matchDecisionId);
    return mutation ? cloneForRead(mutation) : null;
  }

  listArticles({ issueId }) {
    return [...this.issueArticlesByKey.values()].filter((article) => article.issueId === issueId).map(cloneForRead);
  }

  listDevelopments({ issueId }) {
    return [...this.developmentsById.values()].filter((development) => development.issueId === issueId).map(cloneForRead);
  }

  getLatestDevelopment({ tenantId, companyId, issueId }) {
    const developments = [...this.developmentsById.values()]
      .filter((development) => development.tenantId === tenantId && development.companyId === companyId && development.issueId === issueId)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.developmentId.localeCompare(left.developmentId));
    return developments[0] ? cloneForRead(developments[0]) : null;
  }

  getDevelopment({ tenantId, companyId, developmentId }) {
    const development = this.developmentsById.get(developmentId);
    return development && development.tenantId === tenantId && development.companyId === companyId ? cloneForRead(development) : null;
  }

  getArticleForDevelopment({ tenantId, companyId, developmentId }) {
    const development = this.getDevelopment({ tenantId, companyId, developmentId });
    if (!development || typeof development.issueArticleId !== "string") return null;
    const article = [...this.issueArticlesByKey.values()].find((item) => item.issueArticleId === development.issueArticleId);
    return article && article.tenantId === tenantId && article.companyId === companyId ? cloneForRead(article) : null;
  }

  getGeneratedTitle({ issueId, developmentId, promptVersion }) {
    const title = this.titleGenerationsByKey.get(this._titleKey({ issueId, developmentId, promptVersion }));
    return title ? cloneForRead(title) : null;
  }

  applyGeneratedTitle({ tenantId, companyId, issueId, developmentId, promptVersion, title, provenance }) {
    const key = this._titleKey({ issueId, developmentId, promptVersion });
    const existing = this.titleGenerationsByKey.get(key);
    if (existing) return { title: cloneForRead(existing), reused: true };
    const issue = this._requireActiveIssue({ tenantId, companyId, issueId });
    if (typeof issue.title === "string" && issue.title.trim()) {
      throw new AiConfigurationError("Issue title generation cannot overwrite an existing title");
    }
    const now = this._timestamp();
    issue.title = title;
    issue.updatedAt = now;
    issue.version += 1;
    const generated = {
      titleGenerationId: this.uuid(), tenantId, companyId, issueId, developmentId, promptVersion,
      title, provenance: structuredClone(provenance), createdAt: now,
    };
    this.titleGenerationsByKey.set(key, generated);
    return { title: cloneForRead(generated), reused: false };
  }

  getGeneratedOneLiner({ issueId, developmentId, promptVersion }) {
    const oneLiner = this.oneLinerGenerationsByKey.get(this._oneLinerKey({ issueId, developmentId, promptVersion }));
    return oneLiner ? cloneForRead(oneLiner) : null;
  }

  applyGeneratedOneLiner({ tenantId, companyId, issueId, developmentId, promptVersion, oneLiner, provenance }) {
    const key = this._oneLinerKey({ issueId, developmentId, promptVersion });
    const existing = this.oneLinerGenerationsByKey.get(key);
    if (existing) return { oneLiner: cloneForRead(existing), reused: true };
    const issue = this._requireActiveIssue({ tenantId, companyId, issueId });
    if (typeof issue.oneLiner === "string" && issue.oneLiner.trim()) {
      throw new AiConfigurationError("Issue one-liner generation cannot overwrite an existing one-liner");
    }
    const now = this._timestamp();
    issue.oneLiner = oneLiner;
    issue.updatedAt = now;
    issue.version += 1;
    const generated = {
      oneLinerGenerationId: this.uuid(), tenantId, companyId, issueId, developmentId, promptVersion,
      oneLiner, provenance: structuredClone(provenance), createdAt: now,
    };
    this.oneLinerGenerationsByKey.set(key, generated);
    return { oneLiner: cloneForRead(generated), reused: false };
  }

  getAlertContentReadiness({ tenantId, companyId, issueId }) {
    const issue = this.getIssue({ tenantId, companyId, issueId });
    if (!issue) return null;
    const missingFields = [];
    if (!(typeof issue.title === "string" && issue.title.trim())) missingFields.push("title");
    if (!(typeof issue.oneLiner === "string" && issue.oneLiner.trim())) missingFields.push("one_liner");
    return { contentReady: missingFields.length === 0, missingFields };
  }

  applyCurrentPriority({ tenantId, companyId, issueId, analysisId, priorityDecisionId, priority }) {
    if (!["tinggi", "sedang", "rendah"].includes(priority) || typeof analysisId !== "string" || typeof priorityDecisionId !== "string") {
      throw new AiConfigurationError("Issue priority update received an invalid priority decision");
    }
    const key = `${tenantId}|${companyId}|${issueId}|${analysisId}|${priorityDecisionId}`;
    const existing = this.currentPriorityApplicationsByKey.get(key);
    if (existing) return { issue: this.getIssue({ tenantId, companyId, issueId }), reused: true };
    const issue = this._requireActiveIssue({ tenantId, companyId, issueId });
    issue.currentPriority = priority;
    issue.currentPriorityAnalysisId = analysisId;
    issue.currentPriorityDecisionId = priorityDecisionId;
    issue.updatedAt = this._timestamp();
    issue.version += 1;
    this.currentPriorityApplicationsByKey.set(key, true);
    return { issue: cloneForRead(issue), reused: false };
  }

  complete({ tenantId, companyId, issueId, expectedVersion, idempotencyKey }) {
    const key = `${tenantId}|${companyId}|${issueId}|${idempotencyKey}`;
    const prior = this.completionsByKey.get(key);
    if (prior) return { issue: cloneForRead(prior), reused: true };
    const issue = this.issuesById.get(issueId);
    if (!issue || issue.tenantId !== tenantId || issue.companyId !== companyId) throw Object.assign(new Error("Issue was not found"), { code: "NOT_FOUND", statusCode: 404 });
    if (!Number.isInteger(expectedVersion) || expectedVersion !== issue.version) throw Object.assign(new Error("Issue version is stale"), { code: "VERSION_CONFLICT", statusCode: 409 });
    if (issue.status === "selesai") { this.completionsByKey.set(key, issue); return { issue: cloneForRead(issue), reused: true }; }
    issue.status = "selesai"; issue.closedAt = new Date(this.now()).toISOString(); issue.updatedAt = issue.closedAt; issue.version += 1;
    this.completionsByKey.set(key, issue);
    return { issue: cloneForRead(issue), reused: false };
  }

  apply({ tenantId, companyId, matchDecision, relevanceDecision }) {
    const existing = this.mutationsByMatchDecisionId.get(matchDecision.matchDecisionId);
    if (existing) return { mutation: cloneForRead(existing), reused: true };
    this._validateScopes({ tenantId, companyId, matchDecision, relevanceDecision });

    const now = this._timestamp();
    let issue;
    if (matchDecision.decision === "new") {
      issue = this._createIssue({ tenantId, companyId, now });
    } else {
      issue = this._requireActiveIssue({ tenantId, companyId, issueId: matchDecision.candidateIssueId });
    }

    const articleKey = this._articleKey({ issueId: issue.issueId, relevanceDecision });
    const existingArticle = this.issueArticlesByKey.get(articleKey);
    if (existingArticle) {
      const mutation = this._createMutation({ tenantId, companyId, matchDecision, issue, article: existingArticle, development: null, now, outcome: "evidence_already_attached" });
      return { mutation: cloneForRead(mutation), reused: false };
    }

    const article = {
      issueArticleId: this.uuid(), tenantId, companyId, issueId: issue.issueId,
      sourceArticleId: relevanceDecision.source.sourceArticleId,
      locale: relevanceDecision.source.requestedLocale,
      sourceUpdatedAt: relevanceDecision.source.updatedAt,
      canonicalUrl: relevanceDecision.source.canonicalUrl,
      attachedAt: now,
      relationStatus: "active",
    };
    const development = {
      developmentId: this.uuid(), tenantId, companyId, issueId: issue.issueId,
      issueArticleId: article.issueArticleId,
      relevanceDecisionId: relevanceDecision.decisionId,
      matchDecisionId: matchDecision.matchDecisionId,
      developmentType: matchDecision.decision === "new" ? "created" : "updated",
      observedAt: now,
      isMaterial: null,
      createdAt: now,
    };
    this.issueArticlesByKey.set(articleKey, article);
    this.developmentsById.set(development.developmentId, development);
    issue.lastDevelopedAt = now;
    issue.updatedAt = now;
    if (matchDecision.decision === "update") issue.version += 1;
    const mutation = this._createMutation({ tenantId, companyId, matchDecision, issue, article, development, now, outcome: "applied" });
    return { mutation: cloneForRead(mutation), reused: false };
  }

  _createIssue({ tenantId, companyId, now }) {
    const issue = {
      issueId: this.uuid(), tenantId, companyId,
      title: null, oneLiner: null,
      status: "baru", currentPriority: null,
      firstSeenAt: now, lastDevelopedAt: now,
      version: 1, closedAt: null, createdAt: now, updatedAt: now,
    };
    this.issuesById.set(issue.issueId, issue);
    return issue;
  }

  _requireActiveIssue({ tenantId, companyId, issueId }) {
    const issue = this.issuesById.get(issueId);
    if (!issue || issue.tenantId !== tenantId || issue.companyId !== companyId || !ACTIVE_ISSUE_STATUSES.has(issue.status)) {
      throw new AiConfigurationError("Issue mutation requires an active issue in the same tenant and company");
    }
    return issue;
  }

  _validateScopes({ tenantId, companyId, matchDecision, relevanceDecision }) {
    if (!matchDecision || matchDecision.tenantId !== tenantId || matchDecision.companyId !== companyId
      || !relevanceDecision || relevanceDecision.companyId !== companyId
      || !["new", "update"].includes(matchDecision.decision)) {
      throw new AiConfigurationError("Issue mutation received a cross-scope or invalid T04 decision");
    }
    if ((matchDecision.decision === "new" && matchDecision.candidateIssueId !== null)
      || (matchDecision.decision === "update" && !matchDecision.candidateIssueId)) {
      throw new AiConfigurationError("Issue mutation received an invalid T04 new/update shape");
    }
    if ((matchDecision.decision === "new" && !["new_event", "insufficient_data"].includes(matchDecision.reasonCode))
      || (matchDecision.decision === "update" && matchDecision.reasonCode !== "same_event")) {
      throw new AiConfigurationError("Issue mutation received an invalid T04 reason code");
    }
  }

  _createMutation({ tenantId, companyId, matchDecision, issue, article, development, now, outcome }) {
    const mutation = {
      mutationId: this.uuid(), tenantId, companyId,
      matchDecisionId: matchDecision.matchDecisionId,
      relevanceDecisionId: matchDecision.relevanceDecisionId,
      issueId: issue.issueId, issueArticleId: article.issueArticleId,
      developmentId: development?.developmentId || null,
      outcome, createdAt: now,
    };
    this.mutationsByMatchDecisionId.set(matchDecision.matchDecisionId, mutation);
    return mutation;
  }

  _articleKey({ issueId, relevanceDecision }) {
    return `${issueId}|${relevanceDecision.source.sourceArticleId}|${relevanceDecision.source.requestedLocale}|${relevanceDecision.source.updatedAt || "unknown"}`;
  }

  _timestamp() {
    return new Date(this.now()).toISOString();
  }

  _titleKey({ issueId, developmentId, promptVersion }) {
    return `${issueId}|${developmentId}|${promptVersion}`;
  }

  _oneLinerKey({ issueId, developmentId, promptVersion }) {
    return `${issueId}|${developmentId}|${promptVersion}`;
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

module.exports = { InMemoryIssueStore, ACTIVE_ISSUE_STATUSES };
