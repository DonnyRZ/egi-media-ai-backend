const { AiConfigurationError } = require("../../provider/provider.errors");
const { loadCompanyOutputLanguage } = require("../../../language/resolve-company-output-language");
const { T09_PROMPT_VERSION } = require("../t09-priority-enum/definition");
const { T10_PROMPT_VERSION } = require("../t10-priority-reason/definition");
const { T12_PROMPT_ID, T12_PROMPT_VERSION } = require("./definition");
const { T12_OUTPUT_SCHEMA } = require("./schema");
const { buildT12Input } = require("./prompt");
const { validateT12Output } = require("./output-validator");

class DirectAlertBlurbService {
  constructor({ eventStore, issueStore, analysisStore, priorityStore, reasonStore, blurbStore, promptExecutionService, companyStore = null, resolveOutputLanguage = null, getEffectiveContext = null, authorizeCompany = denyByDefault }) {
    if (!eventStore?.get || !eventStore?.markContentBlocked) throw new AiConfigurationError("T12 requires alert event persistence");
    if (!issueStore?.getIssue || !issueStore?.getDevelopment || !issueStore?.getArticleForDevelopment || !issueStore?.getAlertContentReadiness) throw new AiConfigurationError("T12 requires scoped issue and development reads");
    if (!analysisStore?.getCurrent || !priorityStore?.get || !reasonStore?.get) throw new AiConfigurationError("T12 requires validated priority handoff reads");
    if (!blurbStore?.get || !blurbStore?.create || !promptExecutionService?.executeActive) throw new AiConfigurationError("T12 requires blurb persistence and prompt execution");
    Object.assign(this, { eventStore, issueStore, analysisStore, priorityStore, reasonStore, blurbStore, promptExecutionService, companyStore, resolveOutputLanguage, getEffectiveContext, authorizeCompany });
  }

  async generate({ tenantId, companyId, alertEventId }) {
    await this._authorizeCompany({ tenantId, companyId });
    const event = await this.eventStore.get({ tenantId, companyId, alertEventId });
    if (!event || event.channel !== "langsung" || event.status !== "eligible") {
      throw new AiConfigurationError("T12 requires a backend-eligible direct alert event in the same tenant and company");
    }
    const existing = await this.blurbStore.get({ alertEventId, promptVersion: T12_PROMPT_VERSION });
    if (existing) return { blurb: existing, event, reused: true };
    try {
      const input = await this._loadValidatedInput({ tenantId, companyId, event });
      const context = typeof this.getEffectiveContext === "function"
        ? await this.getEffectiveContext(companyId, tenantId)
        : null;
      const outputLanguage = await this._resolveOutputLanguage({ tenantId, companyId });
      const execution = await this.promptExecutionService.executeActive({
        promptId: T12_PROMPT_ID, promptVersion: T12_PROMPT_VERSION, model: "nano",
        input: buildT12Input({ tenantId, companyId, ...input, outputLanguage, context }), outputSchema: T12_OUTPUT_SCHEMA,
        budgetScope: { tenantId, companyId },
        validateResult: (data) => validateT12Output(data, { claimIds: new Set(input.sourceClaims.map((claim) => claim.claimId)) }),
      });
      const blurb = await this.blurbStore.create({
        tenantId, companyId, issueId: event.issueId, developmentId: event.developmentId, alertEventId,
        promptVersion: T12_PROMPT_VERSION, newDevelopmentBlurb: execution.data.newDevelopmentBlurb,
        shortImpactBlurb: execution.data.shortImpactBlurb, sourceClaimIds: execution.data.sourceClaimIds, provenance: execution.provenance,
      });
      return { blurb, event, reused: false };
    } catch (error) {
      await this.eventStore.markContentBlocked({ tenantId, companyId, alertEventId, reasonCode: classifyFailure(error) });
      throw error;
    }
  }

  async _loadValidatedInput({ tenantId, companyId, event }) {
    const issue = await this.issueStore.getIssue({ tenantId, companyId, issueId: event.issueId });
    const development = await this.issueStore.getDevelopment({ tenantId, companyId, developmentId: event.developmentId });
    const article = await this.issueStore.getArticleForDevelopment({ tenantId, companyId, developmentId: event.developmentId });
    const readiness = await this.issueStore.getAlertContentReadiness({ tenantId, companyId, issueId: event.issueId });
    if (!issue || !development || development.issueId !== issue.issueId || !article || !readiness?.contentReady || typeof article.canonicalUrl !== "string" || !article.canonicalUrl) {
      throw new AiConfigurationError("T12 requires complete scoped issue content and a canonical development detail URL");
    }
    const analysis = await this.analysisStore.getCurrent({ tenantId, companyId, issueId: issue.issueId });
    if (!analysis || analysis.analysisId !== issue.currentPriorityAnalysisId || analysis.status !== "current" || !analysis.gate) {
      throw new AiConfigurationError("T12 requires a current citation-gated analysis");
    }
    const priority = await this.priorityStore.get({ tenantId, companyId, issueId: issue.issueId, analysisId: analysis.analysisId, promptVersion: T09_PROMPT_VERSION });
    if (!priority || priority.priority !== "tinggi" || priority.priorityDecisionId !== issue.currentPriorityDecisionId || issue.currentPriority !== "tinggi") {
      throw new AiConfigurationError("T12 requires the current high T09 priority used by the eligible alert");
    }
    const reason = await this.reasonStore.get({ priorityDecisionId: priority.priorityDecisionId, promptVersion: T10_PROMPT_VERSION });
    const sourceClaims = selectSourceClaims({ analysis, sourceClaimIds: reason?.sourceClaimIds });
    if (!reason || sourceClaims.length < 1) throw new AiConfigurationError("T12 requires a validated T10 reason with source claims");
    return { issue, development, detailUrl: article.canonicalUrl, priority: priority.priority, sourceClaims };
  }

  async _resolveOutputLanguage({ tenantId, companyId }) {
    if (typeof this.resolveOutputLanguage === "function") {
      return this.resolveOutputLanguage({ tenantId, companyId });
    }
    return loadCompanyOutputLanguage({ companyStore: this.companyStore, tenantId, companyId });
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "alert.direct_blurb.generate" });
    if (granted !== true) throw new AiConfigurationError("T12 tenant/company authorization was not granted");
  }
}

function selectSourceClaims({ analysis, sourceClaimIds }) {
  if (!Array.isArray(sourceClaimIds) || sourceClaimIds.length < 1 || !Array.isArray(analysis.analysis?.claims)) return [];
  const claimsById = new Map(analysis.analysis.claims.map((claim) => [claim.claim_id, claim]));
  const ids = new Set();
  const result = [];
  for (const claimId of sourceClaimIds) {
    const claim = claimsById.get(claimId);
    if (typeof claimId !== "string" || !claim || typeof claim.text !== "string" || ids.has(claimId)) return [];
    ids.add(claimId); result.push({ claimId, text: claim.text });
  }
  return result;
}

function classifyFailure(error) { return error?.code === "AI_OUTPUT_SCHEMA_INVALID" ? "invalid_blurb_output" : "direct_blurb_gate_failed"; }
function denyByDefault() { throw new AiConfigurationError("T12 requires a tenant/company authorization guard"); }

module.exports = { DirectAlertBlurbService, selectSourceClaims };
