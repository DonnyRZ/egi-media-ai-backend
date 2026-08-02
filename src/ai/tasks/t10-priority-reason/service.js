const { AiConfigurationError } = require("../../provider/provider.errors");
const { loadCompanyOutputLanguage } = require("../../../language/resolve-company-output-language");
const { T08_PROMPT_VERSION } = require("../t08-claim-labels/definition");
const { T09_PROMPT_VERSION } = require("../t09-priority-enum/definition");
const { T10_PROMPT_ID, T10_PROMPT_VERSION } = require("./definition");
const { T10_OUTPUT_SCHEMA } = require("./schema");
const { buildT10Input } = require("./prompt");
const { validateT10Output } = require("./output-validator");
const { withPipelineTrace } = require("../../../pipeline/pipeline-trace");

class PriorityReasonService {
  constructor({ issueStore, analysisStore, priorityStore, labelStore, getEffectiveContext, reasonStore, promptExecutionService, companyStore = null, resolveOutputLanguage = null, authorizeCompany = denyByDefault }) {
    if (!issueStore?.getIssue) throw new AiConfigurationError("T10 requires issue lookup");
    if (!analysisStore?.getById || !analysisStore?.getCurrent) throw new AiConfigurationError("T10 requires current validated analysis lookup");
    if (!priorityStore?.get) throw new AiConfigurationError("T10 requires immutable T09 priority lookup");
    if (!labelStore?.get) throw new AiConfigurationError("T10 requires validated T08 claim labels");
    if (typeof getEffectiveContext !== "function") throw new AiConfigurationError("T10 requires effective Company Context reader");
    if (!reasonStore?.get || !reasonStore?.create) throw new AiConfigurationError("T10 requires priority reason persistence");
    if (!promptExecutionService?.executeActive) throw new AiConfigurationError("T10 requires prompt execution service");
    Object.assign(this, { issueStore, analysisStore, priorityStore, labelStore, getEffectiveContext, reasonStore, promptExecutionService, companyStore, resolveOutputLanguage, authorizeCompany });
  }

  async generate({ tenantId, companyId, issueId, analysisId, priorityDecisionId, pipelineId = null }) {
    await this._authorizeCompany({ tenantId, companyId });
    const issue = await this.issueStore.getIssue({ tenantId, companyId, issueId });
    if (!issue || !["baru", "berkembang", "dipantau"].includes(issue.status)) throw new AiConfigurationError("T10 requires an active issue in the same tenant and company");
    const analysis = await this.analysisStore.getById(analysisId);
    const currentAnalysis = await this.analysisStore.getCurrent({ tenantId, companyId, issueId });
    if (!analysis || analysis.tenantId !== tenantId || analysis.companyId !== companyId || analysis.issueId !== issueId
      || analysis.status !== "current" || currentAnalysis?.analysisId !== analysisId || !analysis.gate) {
      throw new AiConfigurationError("T10 requires the current citation-gated analysis for the same issue, tenant, and company");
    }
    const priorityDecision = await this.priorityStore.get({ tenantId, companyId, issueId, analysisId, promptVersion: T09_PROMPT_VERSION });
    if (!priorityDecision || priorityDecision.priorityDecisionId !== priorityDecisionId || !["tinggi", "sedang", "rendah"].includes(priorityDecision.priority)
      || issue.currentPriority !== priorityDecision.priority || issue.currentPriorityAnalysisId !== analysisId || issue.currentPriorityDecisionId !== priorityDecisionId) {
      throw new AiConfigurationError("T10 requires the immutable current T09 priority decision for this analysis");
    }
    const labels = await this.labelStore.get({ analysisId, promptVersion: T08_PROMPT_VERSION });
    const labeledClaims = buildLabeledClaims({ analysis, labels });
    const context = await this.getEffectiveContext(companyId, tenantId);
    if (!context || context.companyId !== companyId || context.status !== "effective" || !Number.isInteger(context.version)) {
      throw new AiConfigurationError("T10 requires an effective Company Context for the same company");
    }
    const existing = await this.reasonStore.get({ priorityDecisionId, promptVersion: T10_PROMPT_VERSION });
    if (existing) return { reason: existing, priorityDecision, analysis, reused: true };
    const claimIds = new Set(labeledClaims.map((claim) => claim.claimId));
    const outputLanguage = await this._resolveOutputLanguage({ tenantId, companyId });
    const execution = await this.promptExecutionService.executeActive({
      promptId: T10_PROMPT_ID,
      promptVersion: T10_PROMPT_VERSION,
      model: "mini",
      input: buildT10Input({ tenantId, companyId, issue, analysis, context, priorityDecision, labeledClaims, outputLanguage }),
      outputSchema: T10_OUTPUT_SCHEMA,
      budgetScope: { tenantId, companyId },
      validateResult: (data) => validateT10Output(data, { claimIds }),
    });
    const reason = await this.reasonStore.create({
      tenantId, companyId, issueId, analysisId, priorityDecisionId, promptVersion: T10_PROMPT_VERSION,
      reason: execution.data.reason, sourceClaimIds: execution.data.sourceClaimIds,
      provenance: withPipelineTrace(execution.provenance, pipelineId), pipelineId, inputFingerprint: analysis.inputFingerprint,
    });
    return { reason, priorityDecision, analysis, reused: false };
  }

  async _resolveOutputLanguage({ tenantId, companyId }) {
    if (typeof this.resolveOutputLanguage === "function") {
      return this.resolveOutputLanguage({ tenantId, companyId });
    }
    return loadCompanyOutputLanguage({ companyStore: this.companyStore, tenantId, companyId });
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "issue.priority.reason.generate" });
    if (granted !== true) throw new AiConfigurationError("T10 tenant/company authorization was not granted");
  }
}

function buildLabeledClaims({ analysis, labels }) {
  const claims = analysis.analysis?.claims;
  if (!labels || !Array.isArray(claims) || claims.length < 1 || !Array.isArray(labels.labels) || labels.labels.length !== claims.length) {
    throw new AiConfigurationError("T10 requires complete T08 labels for the current analysis claims");
  }
  const labelsByClaimId = new Map();
  for (const label of labels.labels) {
    if (!label || typeof label.claim_id !== "string" || !["fact", "analysis", "assumption"].includes(label.label) || labelsByClaimId.has(label.claim_id)) {
      throw new AiConfigurationError("T10 requires valid unique T08 labels");
    }
    labelsByClaimId.set(label.claim_id, label.label);
  }
  const labeledClaims = claims.map((claim) => ({ claimId: claim.claim_id, text: claim.text, label: labelsByClaimId.get(claim.claim_id) }));
  if (new Set(labeledClaims.map((claim) => claim.claimId)).size !== claims.length || labeledClaims.some((claim) => typeof claim.claimId !== "string" || typeof claim.text !== "string" || !claim.label)) {
    throw new AiConfigurationError("T10 requires labels for exactly the existing T07 claim IDs");
  }
  return labeledClaims;
}

function denyByDefault() { throw new AiConfigurationError("T10 requires a tenant/company authorization guard"); }

module.exports = { PriorityReasonService, buildLabeledClaims };
