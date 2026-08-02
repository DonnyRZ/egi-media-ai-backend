const { AiConfigurationError } = require("../../provider/provider.errors");
const { T04_PROMPT_ID, T04_PROMPT_VERSION } = require("./definition");
const { T04_OUTPUT_SCHEMA } = require("./schema");
const { buildT04Input } = require("./prompt");
const { validateT04Output } = require("./output-validator");
const { fingerprint, resolveT02InputOptions } = require("../t02-relevance-class/service");
const { shouldFormIssue } = require("../t02-relevance-class/relevance-policy");
const { ACTIVE_ISSUE_STATUSES } = require("./issue-candidate.store");
const { withPipelineTrace } = require("../../../pipeline/pipeline-trace");

class IssueMatchService {
  constructor({ cmsSourceGate, decisionStore, issueCandidateStore, matchDecisionStore, promptExecutionService, authorizeCompany = denyByDefault }) {
    if (!cmsSourceGate?.requirePublishedArticle) throw new AiConfigurationError("T04 requires CMS source gate");
    if (!decisionStore?.getById) throw new AiConfigurationError("T04 requires relevance decision lookup");
    if (!issueCandidateStore?.listActive) throw new AiConfigurationError("T04 requires a company-scoped issue candidate store");
    if (!matchDecisionStore?.get || !matchDecisionStore?.create) throw new AiConfigurationError("T04 requires issue match decision store");
    if (!promptExecutionService?.executeActive) throw new AiConfigurationError("T04 requires prompt execution service");
    this.cmsSourceGate = cmsSourceGate;
    this.decisionStore = decisionStore;
    this.issueCandidateStore = issueCandidateStore;
    this.matchDecisionStore = matchDecisionStore;
    this.promptExecutionService = promptExecutionService;
    this.authorizeCompany = authorizeCompany;
  }

  async match({ tenantId, companyId, relevanceDecisionId, pipelineId = null }) {
    await this._authorizeCompany({ tenantId, companyId });
    const relevanceDecision = await this.decisionStore.getById(relevanceDecisionId);
    this._validateRelevanceDecision(relevanceDecision, companyId);
    const existing = await this.matchDecisionStore.get({ tenantId, companyId, relevanceDecisionId, promptVersion: T04_PROMPT_VERSION });
    if (existing) return { match: existing, relevanceDecision, reused: true };

    const source = await this.cmsSourceGate.requirePublishedArticle({
      articleId: relevanceDecision.articleId,
      locale: relevanceDecision.source.requestedLocale,
    });
    if (fingerprint({ source, contextVersion: relevanceDecision.contextVersion, inputOptions: resolveT02InputOptions() }) !== relevanceDecision.inputFingerprint) {
      throw new AiConfigurationError("T04 refuses to match a stale T02 article snapshot");
    }

    const candidates = await this.issueCandidateStore.listActive({ tenantId, companyId });
    this._validateCandidates(candidates, { tenantId, companyId });
    const candidateIssueIds = new Set(candidates.map((candidate) => candidate.issueId));
    const existingSource = await this._findExistingSourceIssue({
      tenantId,
      companyId,
      candidates,
      sourceArticleId: relevanceDecision.articleId,
      canonicalUrl: source.canonicalUrl,
    });
    if (existingSource) {
      const match = await this.matchDecisionStore.create({
        tenantId,
        companyId,
        relevanceDecisionId,
        promptVersion: T04_PROMPT_VERSION,
        output: {
          decision: "update",
          candidate_issue_id: existingSource.issue.issueId,
          reason_code: "same_event",
        },
        provenance: withPipelineTrace({
          policy: existingSource.policy,
          sourceArticleId: relevanceDecision.articleId,
          canonicalUrl: source.canonicalUrl,
        }, pipelineId),
        pipelineId,
        inputFingerprint: relevanceDecision.inputFingerprint,
      });
      return { match, relevanceDecision, reused: false };
    }
    const execution = await this.promptExecutionService.executeActive({
      promptId: T04_PROMPT_ID,
      promptVersion: T04_PROMPT_VERSION,
      model: "nano",
      input: buildT04Input({ tenantId, companyId, decision: relevanceDecision, source, candidates }),
      outputSchema: T04_OUTPUT_SCHEMA,
      budgetScope: { tenantId, companyId },
      validateResult: (data) => validateT04Output(data, { candidateIssueIds }),
    });
    const match = await this.matchDecisionStore.create({
      tenantId, companyId, relevanceDecisionId, promptVersion: T04_PROMPT_VERSION,
      output: execution.data, provenance: withPipelineTrace(execution.provenance, pipelineId),
      pipelineId, inputFingerprint: relevanceDecision.inputFingerprint,
    });
    return { match, relevanceDecision, reused: false };
  }

  _validateRelevanceDecision(decision, companyId) {
    const formsIssue = decision && shouldFormIssue({
      relevance: decision.relevance,
      subjectRelation: decision.subjectRelation,
      competitorOptIn: decision.competitorOptIn === true,
    });
    if (!decision || decision.companyId !== companyId || !formsIssue || decision.branch !== "continue") {
      throw new AiConfigurationError("T04 requires a continuing identity-gated T02 decision for the same company");
    }
  }

  _validateCandidates(candidates, { tenantId, companyId }) {
    if (!Array.isArray(candidates) || candidates.some((candidate) => candidate.tenantId !== tenantId
      || candidate.companyId !== companyId || !ACTIVE_ISSUE_STATUSES.has(candidate.status))) {
      throw new AiConfigurationError("T04 candidate validation rejected a cross-scope or inactive issue");
    }
  }

  async _findExistingSourceIssue({ tenantId, companyId, candidates, sourceArticleId, canonicalUrl }) {
    if (typeof this.issueCandidateStore.listArticles !== "function") return null;
    for (const candidate of candidates) {
      const articles = await this.issueCandidateStore.listArticles({
        tenantId,
        companyId,
        issueId: candidate.issueId,
      });
      const activeArticles = Array.isArray(articles)
        ? articles.filter((article) => article.relationStatus === "active")
        : [];
      if (activeArticles.some((article) => article.sourceArticleId === sourceArticleId)) {
        return { issue: candidate, policy: "exact-source-reuse" };
      }
      if (typeof canonicalUrl === "string" && canonicalUrl.length > 0
        && activeArticles.some((article) => article.canonicalUrl === canonicalUrl)) {
        return { issue: candidate, policy: "canonical-source-reuse" };
      }
    }
    return null;
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "issue.match" });
    if (granted !== true) throw new AiConfigurationError("T04 tenant/company authorization was not granted");
  }
}

function denyByDefault() {
  throw new AiConfigurationError("T04 requires a tenant/company authorization guard");
}

module.exports = { IssueMatchService };
