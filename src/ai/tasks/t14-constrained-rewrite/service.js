const { AiConfigurationError } = require("../../provider/provider.errors");
const { loadCompanyOutputLanguage } = require("../../../language/resolve-company-output-language");
const { resolveConstrainedSpan } = require("../../../reports/report-narrative.spans");
const { T14_PROMPT_ID, T14_PROMPT_VERSION } = require("./definition");
const { T14_OUTPUT_SCHEMA } = require("./schema");
const { buildT14Input } = require("./prompt");
const { validateT14Output } = require("./output-validator");

class ConstrainedRewriteService {
  constructor({ reportDraftStore, narrativeStore, promptExecutionService, companyStore = null, resolveOutputLanguage = null, authorizeCompany = denyByDefault }) {
    if (!reportDraftStore?.get) throw new AiConfigurationError("T14 requires report draft lookup");
    if (!narrativeStore?.getById || !narrativeStore?.applyConstrainedRewrite) throw new AiConfigurationError("T14 requires versioned report narrative persistence");
    if (!promptExecutionService?.executeActive) throw new AiConfigurationError("T14 requires prompt execution service");
    Object.assign(this, { reportDraftStore, narrativeStore, promptExecutionService, companyStore, resolveOutputLanguage, authorizeCompany });
  }
  async rewrite({ tenantId, companyId, reportId, reportNarrativeId, expectedVersion, allowedSpanId, humanInstruction, actor }) {
    assertHumanActor(actor); assertInstruction(humanInstruction);
    await this._authorizeCompany({ tenantId, companyId, actor });
    const report = await this.reportDraftStore.get({ tenantId, companyId, reportId });
    const narrative = await this.narrativeStore.getById({ tenantId, companyId, reportNarrativeId });
    if (!report || !narrative || narrative.reportId !== reportId || report.reviewStatus !== "draft" || narrative.reviewStatus !== "draft") throw new AiConfigurationError("T14 requires a draft report and draft narrative in the same tenant and company");
    if (!Number.isInteger(expectedVersion) || narrative.version !== expectedVersion) throw new AiConfigurationError("T14 target narrative version conflict");
    const span = resolveConstrainedSpan(narrative.narrative, allowedSpanId);
    if (!span) throw new AiConfigurationError("T14 allowed span must be an explicit cited report span");
    const sourceClaims = selectApprovedClaims({ report, narrative, span });
    if (sourceClaims.length !== span.sourceClaimIds.length) throw new AiConfigurationError("T14 requires the span's existing approved factual source set");
    const outputLanguage = await this._resolveOutputLanguage({ tenantId, companyId });
    const execution = await this.promptExecutionService.executeActive({
      promptId: T14_PROMPT_ID, promptVersion: T14_PROMPT_VERSION, model: "nano",
      input: buildT14Input({ tenantId, companyId, report, narrative, span, humanInstruction, sourceClaims, outputLanguage }), outputSchema: T14_OUTPUT_SCHEMA,
      budgetScope: { tenantId, companyId },
      validateResult: validateT14Output,
    });
    const result = await this.narrativeStore.applyConstrainedRewrite({ tenantId, companyId, reportNarrativeId, expectedVersion, allowedSpanId, replacementText: execution.data.replacementText, actor, humanInstruction, provenance: execution.provenance });
    if (!result?.narrative) throw new AiConfigurationError("T14 target narrative version conflict");
    return { narrative: result.narrative, report, rewrittenSpan: { spanId: span.spanId, sourceClaimIds: span.sourceClaimIds }, reused: false };
  }
  async _resolveOutputLanguage({ tenantId, companyId }) {
    if (typeof this.resolveOutputLanguage === "function") {
      return this.resolveOutputLanguage({ tenantId, companyId });
    }
    return loadCompanyOutputLanguage({ companyStore: this.companyStore, tenantId, companyId });
  }
  async _authorizeCompany({ tenantId, companyId, actor }) { const granted = await this.authorizeCompany({ tenantId, companyId, actor, action: "report.narrative.rewrite" }); if (granted !== true) throw new AiConfigurationError("T14 tenant/company authorization was not granted"); }
}

function selectApprovedClaims({ report, narrative, span }) {
  const references = new Map((narrative.narrative.sourceReferences || []).map((ref) => [ref.claimId, ref.sourceArticleId]));
  const claims = new Map(report.selectedIssuePack.flatMap((item) => item.claims).map((claim) => [claim.claimId, claim]));
  const result = [];
  for (const claimId of span.sourceClaimIds) {
    const claim = claims.get(claimId);
    if (!claim || !references.has(claimId) || !Array.isArray(claim.sourceArticleIds) || !claim.sourceArticleIds.includes(references.get(claimId)) || typeof claim.text !== "string" || !claim.text.trim()) return [];
    result.push({ claimId, text: claim.text });
  }
  return result;
}
function assertHumanActor(actor) { if (!actor || actor.actorType !== "human" || typeof actor.actorId !== "string" || !actor.actorId) throw new AiConfigurationError("T14 requires an authenticated human actor"); }
function assertInstruction(value) { if (typeof value !== "string" || !value.trim() || value.length > 1000) throw new AiConfigurationError("T14 requires one bounded human rewrite instruction"); }
function denyByDefault() { throw new AiConfigurationError("T14 requires a tenant/company authorization guard"); }
module.exports = { ConstrainedRewriteService, selectApprovedClaims };
