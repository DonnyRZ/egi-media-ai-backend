const { AiConfigurationError } = require("../../provider/provider.errors");
const { T09_PROMPT_ID, T09_PROMPT_VERSION } = require("./definition");
const { T09_OUTPUT_SCHEMA } = require("./schema");
const { buildT09Input } = require("./prompt");
const { validateT09Output } = require("./output-validator");

class IssuePriorityEnumService {
  constructor({ issueStore, analysisStore, getEffectiveContext, priorityStore, promptExecutionService, authorizeCompany = denyByDefault }) {
    if (!issueStore?.getIssue || !issueStore?.getLatestDevelopment || !issueStore?.applyCurrentPriority) throw new AiConfigurationError("T09 requires issue priority persistence");
    if (!analysisStore?.getById || !analysisStore?.getCurrent) throw new AiConfigurationError("T09 requires current validated analysis lookup");
    if (typeof getEffectiveContext !== "function") throw new AiConfigurationError("T09 requires effective Company Context reader");
    if (!priorityStore?.get || !priorityStore?.create) throw new AiConfigurationError("T09 requires priority decision persistence");
    if (!promptExecutionService?.executeActive) throw new AiConfigurationError("T09 requires prompt execution service");
    Object.assign(this, { issueStore, analysisStore, getEffectiveContext, priorityStore, promptExecutionService, authorizeCompany });
  }

  async evaluate({ tenantId, companyId, issueId, analysisId }) {
    await this._authorizeCompany({ tenantId, companyId });
    const issue = await this.issueStore.getIssue({ tenantId, companyId, issueId });
    if (!issue || !["baru", "berkembang", "dipantau"].includes(issue.status)) throw new AiConfigurationError("T09 requires an active issue in the same tenant and company");
    const analysis = await this.analysisStore.getById(analysisId);
    const currentAnalysis = await this.analysisStore.getCurrent({ tenantId, companyId, issueId });
    if (!analysis || analysis.tenantId !== tenantId || analysis.companyId !== companyId || analysis.issueId !== issueId
      || analysis.status !== "current" || currentAnalysis?.analysisId !== analysisId || !analysis.gate) {
      throw new AiConfigurationError("T09 requires the current citation-gated analysis for the same issue, tenant, and company");
    }
    const latestDevelopment = await this.issueStore.getLatestDevelopment({ tenantId, companyId, issueId });
    if (!latestDevelopment) throw new AiConfigurationError("T09 requires a valid issue development");
    const context = await this.getEffectiveContext(companyId, tenantId);
    if (!context || context.companyId !== companyId || context.status !== "effective" || !Number.isInteger(context.version)) {
      throw new AiConfigurationError("T09 requires an effective Company Context for the same company");
    }
    const existing = await this.priorityStore.get({ tenantId, companyId, issueId, analysisId, promptVersion: T09_PROMPT_VERSION });
    if (existing) return { priority: existing, issue, analysis, reused: true };
    const execution = await this.promptExecutionService.executeActive({
      promptId: T09_PROMPT_ID,
      promptVersion: T09_PROMPT_VERSION,
      model: "nano",
      input: buildT09Input({ tenantId, companyId, issue, analysis, context, latestDevelopment }),
      outputSchema: T09_OUTPUT_SCHEMA,
      budgetScope: { tenantId, companyId },
      validateResult: validateT09Output,
    });
    const priority = await this.priorityStore.create({
      tenantId, companyId, issueId, analysisId, contextVersion: context.version,
      promptVersion: T09_PROMPT_VERSION, priority: execution.data.priority, provenance: execution.provenance,
    });
    const applied = await this.issueStore.applyCurrentPriority({
      tenantId, companyId, issueId, analysisId, priorityDecisionId: priority.priorityDecisionId, priority: priority.priority,
    });
    return { priority, issue: applied.issue, analysis, reused: false };
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "issue.priority.evaluate" });
    if (granted !== true) throw new AiConfigurationError("T09 tenant/company authorization was not granted");
  }
}

function denyByDefault() { throw new AiConfigurationError("T09 requires a tenant/company authorization guard"); }

module.exports = { IssuePriorityEnumService };
