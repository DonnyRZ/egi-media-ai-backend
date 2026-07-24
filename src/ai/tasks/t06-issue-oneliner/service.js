const { AiConfigurationError } = require("../../provider/provider.errors");
const { T06_PROMPT_ID, T06_PROMPT_VERSION } = require("./definition");
const { T06_OUTPUT_SCHEMA } = require("./schema");
const { buildT06Input } = require("./prompt");
const { validateT06Output } = require("./output-validator");
const { fingerprint } = require("../t02-relevance-class/service");

const ACTIVE_STATUSES = new Set(["baru", "berkembang", "dipantau"]);

class IssueOneLinerService {
  constructor({ cmsSourceGate, issueStore, matchDecisionStore, relevanceDecisionStore, promptExecutionService, authorizeCompany = denyByDefault }) {
    if (!cmsSourceGate?.requirePublishedArticle) throw new AiConfigurationError("T06 requires CMS source gate");
    if (!issueStore?.getIssue || !issueStore?.getLatestDevelopment || !issueStore?.getGeneratedOneLiner || !issueStore?.applyGeneratedOneLiner) {
      throw new AiConfigurationError("T06 requires issue one-liner persistence");
    }
    if (!matchDecisionStore?.getById || !relevanceDecisionStore?.getById || !promptExecutionService?.executeActive) {
      throw new AiConfigurationError("T06 requires validated upstream decisions and prompt execution");
    }
    Object.assign(this, { cmsSourceGate, issueStore, matchDecisionStore, relevanceDecisionStore, promptExecutionService, authorizeCompany });
  }

  async generate({ tenantId, companyId, issueId }) {
    await this._authorizeCompany({ tenantId, companyId });
    const issue = await this.issueStore.getIssue({ tenantId, companyId, issueId });
    this._validateIssue(issue);
    const development = await this.issueStore.getLatestDevelopment({ tenantId, companyId, issueId });
    if (!development) throw new AiConfigurationError("T06 requires a valid issue development");
    const existing = await this.issueStore.getGeneratedOneLiner({ issueId, developmentId: development.developmentId, promptVersion: T06_PROMPT_VERSION });
    if (existing) return { oneLiner: existing, issue, reused: true };
    if (typeof issue.oneLiner === "string" && issue.oneLiner.trim()) return { oneLiner: { oneLiner: issue.oneLiner, issueId, developmentId: development.developmentId, promptVersion: T06_PROMPT_VERSION }, issue, reused: true };
    const matchDecision = await this.matchDecisionStore.getById(development.matchDecisionId);
    if (!matchDecision || matchDecision.tenantId !== tenantId || matchDecision.companyId !== companyId) {
      throw new AiConfigurationError("T06 requires the scoped T04 decision that created the development");
    }
    const relevanceDecision = await this.relevanceDecisionStore.getById(development.relevanceDecisionId);
    if (!relevanceDecision || relevanceDecision.companyId !== companyId || relevanceDecision.decisionId !== matchDecision.relevanceDecisionId
      || !["high", "medium", "low"].includes(relevanceDecision.relevance)) {
      throw new AiConfigurationError("T06 requires the continuing T02 decision linked by T04");
    }
    const source = await this.cmsSourceGate.requirePublishedArticle({ articleId: relevanceDecision.articleId, locale: relevanceDecision.source.requestedLocale });
    if (fingerprint({ source, contextVersion: relevanceDecision.contextVersion }) !== relevanceDecision.inputFingerprint) {
      throw new AiConfigurationError("T06 refuses to generate from a stale article snapshot");
    }
    const execution = await this.promptExecutionService.executeActive({
      promptId: T06_PROMPT_ID, promptVersion: T06_PROMPT_VERSION, model: "nano",
      input: buildT06Input({ tenantId, companyId, issue, development, matchDecision, source }),
      outputSchema: T06_OUTPUT_SCHEMA, validateResult: validateT06Output,
      budgetScope: { tenantId, companyId },
    });
    const applied = await this.issueStore.applyGeneratedOneLiner({
      tenantId, companyId, issueId, developmentId: development.developmentId, promptVersion: T06_PROMPT_VERSION,
      oneLiner: execution.data.oneLiner, provenance: execution.provenance,
    });
    return { oneLiner: applied.oneLiner, issue: await this.issueStore.getIssue({ tenantId, companyId, issueId }), reused: applied.reused };
  }

  _validateIssue(issue) {
    if (!issue || !ACTIVE_STATUSES.has(issue.status) || !(typeof issue.title === "string" && issue.title.trim())) {
      throw new AiConfigurationError("T06 requires an active issue with a title in the same tenant and company");
    }
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "issue.one_liner.generate" });
    if (granted !== true) throw new AiConfigurationError("T06 tenant/company authorization was not granted");
  }
}

function denyByDefault() { throw new AiConfigurationError("T06 requires a tenant/company authorization guard"); }

module.exports = { IssueOneLinerService };
