const { AiConfigurationError } = require("../../provider/provider.errors");
const { T08_PROMPT_ID, T08_PROMPT_VERSION } = require("./definition");
const { T08_OUTPUT_SCHEMA } = require("./schema");
const { buildT08Input } = require("./prompt");
const { validateT08Output } = require("./output-validator");
const { withPipelineTrace } = require("../../../pipeline/pipeline-trace");

class ClaimLabelService {
  constructor({ analysisStore, labelStore, promptExecutionService, authorizeCompany = denyByDefault }) {
    if (!analysisStore?.getById) throw new AiConfigurationError("T08 requires T07 analysis lookup");
    if (!labelStore?.get || !labelStore?.create) throw new AiConfigurationError("T08 requires claim label persistence");
    if (!promptExecutionService?.executeActive) throw new AiConfigurationError("T08 requires prompt execution service");
    Object.assign(this, { analysisStore, labelStore, promptExecutionService, authorizeCompany });
  }
  async label({ tenantId, companyId, analysisId, pipelineId = null }) {
    await this._authorizeCompany({ tenantId, companyId });
    const analysis = await this.analysisStore.getById(analysisId);
    if (!analysis || analysis.tenantId !== tenantId || analysis.companyId !== companyId || analysis.status !== "validated" || !Array.isArray(analysis.analysis?.claims) || analysis.analysis.claims.length < 1) {
      throw new AiConfigurationError("T08 requires a validated T07 analysis in the same tenant and company");
    }
    const existing = await this.labelStore.get({ analysisId, promptVersion: T08_PROMPT_VERSION });
    if (existing) return { labels: existing, analysis, reused: true };
    const claimIds = new Set(analysis.analysis.claims.map((claim) => claim.claim_id));
    if (claimIds.size !== analysis.analysis.claims.length) throw new AiConfigurationError("T08 requires unique existing T07 claim IDs");
    const execution = await this.promptExecutionService.executeActive({
      promptId: T08_PROMPT_ID, promptVersion: T08_PROMPT_VERSION, model: "nano",
      input: buildT08Input({ tenantId, companyId, analysis }), outputSchema: T08_OUTPUT_SCHEMA,
      budgetScope: { tenantId, companyId },
      validateResult: (data) => validateT08Output(data, { claimIds }),
    });
    const labels = await this.labelStore.create({ tenantId, companyId, analysisId, issueId: analysis.issueId, promptVersion: T08_PROMPT_VERSION, labels: execution.data.labels, provenance: withPipelineTrace(execution.provenance, pipelineId), pipelineId, inputFingerprint: analysis.inputFingerprint });
    return { labels, analysis, reused: false };
  }
  async _authorizeCompany({ tenantId, companyId }) { const granted = await this.authorizeCompany({ tenantId, companyId, action: "analysis.claims.label" }); if (granted !== true) throw new AiConfigurationError("T08 tenant/company authorization was not granted"); }
}
function denyByDefault() { throw new AiConfigurationError("T08 requires a tenant/company authorization guard"); }
module.exports = { ClaimLabelService };
