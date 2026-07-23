const { AiConfigurationError } = require("../../provider/provider.errors");
const { T05_PROMPT_ID, T05_PROMPT_VERSION } = require("./definition");
const { T05_OUTPUT_SCHEMA } = require("./schema");
const { buildT05Input } = require("./prompt");
const { validateT05Output } = require("./output-validator");
const { fingerprint } = require("../t02-relevance-class/service");

const ACTIVE_STATUSES = new Set(["baru", "berkembang", "dipantau"]);

class IssueTitleService {
  constructor({ cmsSourceGate, issueStore, matchDecisionStore, relevanceDecisionStore, promptExecutionService, authorizeCompany = denyByDefault }) {
    if (!cmsSourceGate?.requirePublishedArticle) throw new AiConfigurationError("T05 requires CMS source gate");
    if (!issueStore?.getIssue || !issueStore?.getLatestDevelopment || !issueStore?.getGeneratedTitle || !issueStore?.applyGeneratedTitle) {
      throw new AiConfigurationError("T05 requires issue title persistence");
    }
    if (!matchDecisionStore?.getById) throw new AiConfigurationError("T05 requires T04 decision lookup");
    if (!relevanceDecisionStore?.getById) throw new AiConfigurationError("T05 requires T02 decision lookup");
    if (!promptExecutionService?.executeActive) throw new AiConfigurationError("T05 requires prompt execution service");
    this.cmsSourceGate = cmsSourceGate;
    this.issueStore = issueStore;
    this.matchDecisionStore = matchDecisionStore;
    this.relevanceDecisionStore = relevanceDecisionStore;
    this.promptExecutionService = promptExecutionService;
    this.authorizeCompany = authorizeCompany;
  }

  async generate({ tenantId, companyId, issueId }) {
    await this._authorizeCompany({ tenantId, companyId });
    const issue = this.issueStore.getIssue({ tenantId, companyId, issueId });
    this._validateIssue(issue);
    const development = this.issueStore.getLatestDevelopment({ tenantId, companyId, issueId });
    if (!development) throw new AiConfigurationError("T05 requires a valid issue development");
    const existing = this.issueStore.getGeneratedTitle({ issueId, developmentId: development.developmentId, promptVersion: T05_PROMPT_VERSION });
    if (existing) return { title: existing, issue, reused: true };
    if (typeof issue.title === "string" && issue.title.trim()) {
      throw new AiConfigurationError("T05 runs only for an issue that needs a title");
    }
    const matchDecision = this.matchDecisionStore.getById(development.matchDecisionId);
    this._validateMatchDecision(matchDecision, { tenantId, companyId, development });
    const relevanceDecision = this.relevanceDecisionStore.getById(development.relevanceDecisionId);
    this._validateRelevanceDecision(relevanceDecision, { companyId, matchDecision });
    const source = await this.cmsSourceGate.requirePublishedArticle({
      articleId: relevanceDecision.articleId, locale: relevanceDecision.source.requestedLocale,
    });
    if (fingerprint({ source, contextVersion: relevanceDecision.contextVersion }) !== relevanceDecision.inputFingerprint) {
      throw new AiConfigurationError("T05 refuses to title an issue from a stale article snapshot");
    }
    const execution = await this.promptExecutionService.executeActive({
      promptId: T05_PROMPT_ID,
      promptVersion: T05_PROMPT_VERSION,
      model: "nano",
      input: buildT05Input({ tenantId, companyId, issue, development, matchDecision, source }),
      outputSchema: T05_OUTPUT_SCHEMA,
      validateResult: validateT05Output,
    });
    const applied = this.issueStore.applyGeneratedTitle({
      tenantId, companyId, issueId, developmentId: development.developmentId,
      promptVersion: T05_PROMPT_VERSION, title: execution.data.title, provenance: execution.provenance,
    });
    return { title: applied.title, issue: this.issueStore.getIssue({ tenantId, companyId, issueId }), reused: applied.reused };
  }

  _validateIssue(issue) {
    if (!issue || !ACTIVE_STATUSES.has(issue.status)) throw new AiConfigurationError("T05 requires an active issue in the same tenant and company");
  }

  _validateMatchDecision(matchDecision, { tenantId, companyId, development }) {
    if (!matchDecision || matchDecision.tenantId !== tenantId || matchDecision.companyId !== companyId
      || matchDecision.matchDecisionId !== development.matchDecisionId) {
      throw new AiConfigurationError("T05 requires the scoped T04 decision that created the development");
    }
  }

  _validateRelevanceDecision(relevanceDecision, { companyId, matchDecision }) {
    if (!relevanceDecision || relevanceDecision.companyId !== companyId
      || relevanceDecision.decisionId !== matchDecision.relevanceDecisionId
      || !["high", "medium", "low"].includes(relevanceDecision.relevance)) {
      throw new AiConfigurationError("T05 requires the continuing T02 decision linked by T04");
    }
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "issue.title.generate" });
    if (granted !== true) throw new AiConfigurationError("T05 tenant/company authorization was not granted");
  }
}

function denyByDefault() {
  throw new AiConfigurationError("T05 requires a tenant/company authorization guard");
}

module.exports = { IssueTitleService };
