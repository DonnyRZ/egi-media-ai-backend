const { AiConfigurationError } = require("../../provider/provider.errors");
const { T13_PROMPT_ID, T13_PROMPT_VERSION } = require("./definition");
const { T13_OUTPUT_SCHEMA } = require("./schema");
const { buildT13Input } = require("./prompt");
const { validateT13Output } = require("./output-validator");

class ReportNarrativeService {
  constructor({ reportDraftStore, narrativeStore, promptExecutionService, authorizeCompany = denyByDefault }) {
    if (!reportDraftStore?.get || !reportDraftStore?.markNarrativeInvalid) throw new AiConfigurationError("T13 requires report draft persistence");
    if (!narrativeStore?.get || !narrativeStore?.create || !promptExecutionService?.executeActive) throw new AiConfigurationError("T13 requires narrative persistence and prompt execution");
    Object.assign(this, { reportDraftStore, narrativeStore, promptExecutionService, authorizeCompany });
  }

  async generate({ tenantId, companyId, reportId }) {
    await this._authorizeCompany({ tenantId, companyId });
    const report = this.reportDraftStore.get({ tenantId, companyId, reportId });
    if (!report || report.reviewStatus !== "draft") throw new AiConfigurationError("T13 requires a draft report in the same tenant and company");
    const existing = this.narrativeStore.get({ reportId, promptVersion: T13_PROMPT_VERSION });
    if (existing) return { narrative: existing, report, reused: true };
    try {
      validateReportPack(report);
      const execution = await this.promptExecutionService.executeActive({
        promptId: T13_PROMPT_ID, promptVersion: T13_PROMPT_VERSION, model: "mini",
        input: buildT13Input({ tenantId, companyId, report }), outputSchema: T13_OUTPUT_SCHEMA,
        validateResult: (data) => validateT13Output(data, { report }),
      });
      const narrative = this.narrativeStore.create({ tenantId, companyId, reportId, promptVersion: T13_PROMPT_VERSION, narrative: execution.data, provenance: execution.provenance });
      return { narrative, report, reused: false };
    } catch (error) {
      this.reportDraftStore.markNarrativeInvalid({ tenantId, companyId, reportId, reasonCode: error?.code === "AI_OUTPUT_SCHEMA_INVALID" ? "invalid_narrative_output" : "report_narrative_gate_failed" });
      throw error;
    }
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
