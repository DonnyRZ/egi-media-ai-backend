const { AiConfigurationError } = require("../../provider/provider.errors");
const { loadCompanyOutputLanguage } = require("../../../language/resolve-company-output-language");
const { T13_PROMPT_ID, T13_PROMPT_VERSION } = require("./definition");
const { T13_OUTPUT_SCHEMA } = require("./schema");
const { buildT13Input } = require("./prompt");
const { validateT13Output } = require("./output-validator");
const { withPipelineTrace } = require("../../../pipeline/pipeline-trace");

class ReportNarrativeService {
  constructor({ reportDraftStore, narrativeStore, promptExecutionService, companyStore = null, resolveOutputLanguage = null, getCompanyContextVersion = null, authorizeCompany = denyByDefault }) {
    if (!reportDraftStore?.get || !reportDraftStore?.markNarrativeInvalid) throw new AiConfigurationError("T13 requires report draft persistence");
    if (!narrativeStore?.get || !narrativeStore?.create || !promptExecutionService?.executeActive) throw new AiConfigurationError("T13 requires narrative persistence and prompt execution");
    Object.assign(this, { reportDraftStore, narrativeStore, promptExecutionService, companyStore, resolveOutputLanguage, getCompanyContextVersion, authorizeCompany });
  }

  async generate({ tenantId, companyId, reportId, pipelineId = null }) {
    await this._authorizeCompany({ tenantId, companyId });
    const report = await this.reportDraftStore.get({ tenantId, companyId, reportId });
    if (!report || report.reviewStatus !== "draft") throw new AiConfigurationError("T13 requires a draft report in the same tenant and company");
    const existing = await this.narrativeStore.get({ tenantId, companyId, reportId, promptVersion: T13_PROMPT_VERSION });
    if (existing) return { narrative: existing, report, reused: true };
    try {
      validateReportPack(report);
      const context = typeof this.getCompanyContextVersion === "function"
        ? await this.getCompanyContextVersion(companyId, report.contextVersion, tenantId)
        : null;
      const outputLanguage = await this._resolveOutputLanguage({ tenantId, companyId });
      const execution = await this.promptExecutionService.executeActive({
        promptId: T13_PROMPT_ID, promptVersion: T13_PROMPT_VERSION, model: "mini",
        input: buildT13Input({ tenantId, companyId, report, outputLanguage, context }), outputSchema: T13_OUTPUT_SCHEMA,
        budgetScope: { tenantId, companyId },
        validateResult: (data) => validateT13Output(data, { report }),
      });
      const narrative = await this.narrativeStore.create({ tenantId, companyId, reportId, promptVersion: T13_PROMPT_VERSION, narrative: execution.data, provenance: withPipelineTrace(execution.provenance, pipelineId, context || { contextVersion: report.contextVersion }) });
      return { narrative, report, reused: false };
    } catch (error) {
      await this.reportDraftStore.markNarrativeInvalid({ tenantId, companyId, reportId, reasonCode: error?.code === "AI_OUTPUT_SCHEMA_INVALID" ? "invalid_narrative_output" : "report_narrative_gate_failed" });
      throw error;
    }
  }

  async _resolveOutputLanguage({ tenantId, companyId }) {
    if (typeof this.resolveOutputLanguage === "function") {
      return this.resolveOutputLanguage({ tenantId, companyId });
    }
    return loadCompanyOutputLanguage({ companyStore: this.companyStore, tenantId, companyId });
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "report.narrative.generate" });
    if (granted !== true) throw new AiConfigurationError("T13 tenant/company authorization was not granted");
  }
}

function validateReportPack(report) {
  if (!['harian', 'mingguan', 'bulanan'].includes(report.reportType) || !validDate(report.periodStart) || !validDate(report.periodEnd)
    || Date.parse(report.periodStart) >= Date.parse(report.periodEnd) || typeof report.timezone !== "string" || !Number.isInteger(report.contextVersion)
    || !report.metrics || report.metrics.periodStart !== report.periodStart || report.metrics.periodEnd !== report.periodEnd
    || !Array.isArray(report.selectedIssuePack) || report.selectedIssuePack.length < 1 || report.selectedIssuePack.length > 20) {
    throw new AiConfigurationError("T13 requires a period-consistent backend metric set and selected issue pack");
  }
  const itemIds = new Set(); const issueIds = new Set(); const claimIds = new Set(); const citationIds = new Set();
  for (const item of report.selectedIssuePack) {
    if (!item || typeof item.reportItemId !== "string" || !item.reportItemId || itemIds.has(item.reportItemId) || typeof item.issueId !== "string" || !item.issueId || issueIds.has(item.issueId)
      || typeof item.analysisId !== "string" || !item.analysisId || !['tinggi', 'sedang', 'rendah'].includes(item.priority)
      || !bounded(item.title, 180) || !bounded(item.oneLiner, 320) || !item.analysis || !bounded(item.analysis.whatHappened, 1200) || !bounded(item.analysis.whyMatters, 1200)
      || !Array.isArray(item.claims) || item.claims.length < 1 || item.claims.length > 12 || !Array.isArray(item.citations) || item.citations.length < 1) {
      throw new AiConfigurationError("T13 selected issue pack has invalid or unselected content");
    }
    itemIds.add(item.reportItemId); issueIds.add(item.issueId);
    const localCitationIds = new Set();
    for (const citation of item.citations) {
      if (!citation || typeof citation.sourceArticleId !== "string" || !citation.sourceArticleId || typeof citation.canonicalUrl !== "string" || !citation.canonicalUrl || localCitationIds.has(citation.sourceArticleId)) throw new AiConfigurationError("T13 requires canonical citations selected by backend");
      localCitationIds.add(citation.sourceArticleId); citationIds.add(citation.sourceArticleId);
    }
    for (const claim of item.claims) {
      if (!claim || typeof claim.claimId !== "string" || !claim.claimId || claimIds.has(claim.claimId) || !bounded(claim.text, 1200)
        || !Array.isArray(claim.sourceArticleIds) || claim.sourceArticleIds.length < 1 || claim.sourceArticleIds.some((id) => !localCitationIds.has(id))) throw new AiConfigurationError("T13 requires claims grounded in the selected canonical citations");
      claimIds.add(claim.claimId);
    }
  }
}
function validDate(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function bounded(value, max) { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function denyByDefault() { throw new AiConfigurationError("T13 requires a tenant/company authorization guard"); }
module.exports = { ReportNarrativeService, validateReportPack };
