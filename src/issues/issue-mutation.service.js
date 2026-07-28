const { AiConfigurationError } = require("../ai/provider/provider.errors");
const { shouldFormIssue } = require("../ai/tasks/t02-relevance-class/relevance-policy");

class IssueMutationService {
  constructor({ matchDecisionStore, relevanceDecisionStore, issueStore, authorizeCompany = denyByDefault }) {
    if (!matchDecisionStore?.getById) throw new AiConfigurationError("Issue mutation requires T04 decision lookup");
    if (!relevanceDecisionStore?.getById) throw new AiConfigurationError("Issue mutation requires T02 decision lookup");
    if (!issueStore?.apply) throw new AiConfigurationError("Issue mutation requires issue persistence");
    this.matchDecisionStore = matchDecisionStore;
    this.relevanceDecisionStore = relevanceDecisionStore;
    this.issueStore = issueStore;
    this.authorizeCompany = authorizeCompany;
  }

  async apply({ tenantId, companyId, matchDecisionId }) {
    await this._authorizeCompany({ tenantId, companyId });
    const matchDecision = await this.matchDecisionStore.getById(matchDecisionId);
    if (!matchDecision || matchDecision.tenantId !== tenantId || matchDecision.companyId !== companyId) {
      throw new AiConfigurationError("Issue mutation requires a T04 decision in the same tenant and company");
    }
    const relevanceDecision = await this.relevanceDecisionStore.getById(matchDecision.relevanceDecisionId);
    const formsIssue = relevanceDecision && shouldFormIssue({
      relevance: relevanceDecision.relevance,
      subjectRelation: relevanceDecision.subjectRelation,
      competitorOptIn: relevanceDecision.competitorOptIn === true,
    });
    if (!relevanceDecision || relevanceDecision.companyId !== companyId || !formsIssue) {
      throw new AiConfigurationError("Issue mutation requires an identity-gated continuing T02 decision in the same company");
    }
    return this.issueStore.apply({ tenantId, companyId, matchDecision, relevanceDecision });
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "issue.mutate" });
    if (granted !== true) throw new AiConfigurationError("Issue mutation tenant/company authorization was not granted");
  }
}

function denyByDefault() {
  throw new AiConfigurationError("Issue mutation requires a tenant/company authorization guard");
}

module.exports = { IssueMutationService };
