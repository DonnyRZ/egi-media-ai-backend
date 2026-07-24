const { AiConfigurationError } = require("../../provider/provider.errors");
const { T04_PROMPT_ID, T04_PROMPT_VERSION } = require("./definition");
const { T04_OUTPUT_SCHEMA } = require("./schema");
const { buildT04Input } = require("./prompt");
const { validateT04Output } = require("./output-validator");
const { fingerprint } = require("../t02-relevance-class/service");
const { ACTIVE_ISSUE_STATUSES } = require("./issue-candidate.store");

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

  async match({ tenantId, companyId, relevanceDecisionId }) {
    await this._authorizeCompany({ tenantId, companyId });
    const relevanceDecision = await this.decisionStore.getById(relevanceDecisionId);
    this._validateRelevanceDecision(relevanceDecision, companyId);
    const existing = await this.matchDecisionStore.get({ tenantId, companyId, relevanceDecisionId, promptVersion: T04_PROMPT_VERSION });
    if (existing) return { match: existing, relevanceDecision, reused: true };

    const source = await this.cmsSourceGate.requirePublishedArticle({
      articleId: relevanceDecision.articleId,
      locale: relevanceDecision.source.requestedLocale,
    });
    if (fingerprint({ source, contextVersion: relevanceDecision.contextVersion }) !== relevanceDecision.inputFingerprint) {
      throw new AiConfigurationError("T04 refuses to match a stale T02 article snapshot");
    }

    const candidates = await this.issueCandidateStore.listActive({ tenantId, companyId });
    this._validateCandidates(candidates, { tenantId, companyId });
    const candidateIssueIds = new Set(candidates.map((candidate) => candidate.issueId));
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
      output: execution.data, provenance: execution.provenance,
    });
    return { match, relevanceDecision, reused: false };
  }

  _validateRelevanceDecision(decision, companyId) {
    if (!decision || decision.companyId !== companyId || !["high", "medium", "low"].includes(decision.relevance)
      || decision.branch !== "continue") {
      throw new AiConfigurationError("T04 requires a relevant T02 decision for the same company");
    }
  }

  _validateCandidates(candidates, { tenantId, companyId }) {
    if (!Array.isArray(candidates) || candidates.some((candidate) => candidate.tenantId !== tenantId
      || candidate.companyId !== companyId || !ACTIVE_ISSUE_STATUSES.has(candidate.status))) {
      throw new AiConfigurationError("T04 candidate validation rejected a cross-scope or inactive issue");
    }
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
