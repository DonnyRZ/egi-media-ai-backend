const { AiConfigurationError } = require("../ai/provider/provider.errors");
const { T08_PROMPT_VERSION } = require("../ai/tasks/t08-claim-labels/definition");

class CitationAnalysisGate {
  constructor({ cmsSourceGate, issueStore, analysisStore, labelStore, authorizeCompany = denyByDefault, now = Date.now }) {
    if (!cmsSourceGate?.requirePublishedArticle) throw new AiConfigurationError("Analysis gate requires CMS source gate");
    if (!issueStore?.getIssue || !issueStore?.listArticles) throw new AiConfigurationError("Analysis gate requires issue evidence store");
    if (!analysisStore?.getById || !analysisStore?.getCurrent || !analysisStore?.promoteCurrent) throw new AiConfigurationError("Analysis gate requires current analysis store");
    if (!labelStore?.get) throw new AiConfigurationError("Analysis gate requires claim label store");
    Object.assign(this, { cmsSourceGate, issueStore, analysisStore, labelStore, authorizeCompany, now });
  }

  async validateAndPromote({ tenantId, companyId, analysisId }) {
    await this._authorizeCompany({ tenantId, companyId });
    const analysis = this.analysisStore.getById(analysisId);
    if (!analysis || analysis.tenantId !== tenantId || analysis.companyId !== companyId || analysis.status !== "validated") {
      throw new AiConfigurationError("Analysis gate requires a validated analysis in the same tenant and company");
    }
    const issue = this.issueStore.getIssue({ tenantId, companyId, issueId: analysis.issueId });
    if (!issue) throw new AiConfigurationError("Analysis gate requires its scoped issue");
    const linked = this.issueStore.listArticles({ issueId: analysis.issueId });
    this._validateEvidenceSet({ linked, evidence: analysis.evidence, tenantId, companyId, issueId: analysis.issueId });
    await Promise.all(analysis.evidence.map((evidence) => this._validateFreshCanonicalEvidence(evidence)));
    this._validateCitations({ analysis, evidence: analysis.evidence });
    const labels = this.labelStore.get({ analysisId, promptVersion: T08_PROMPT_VERSION });
    this._validateLabels({ labels, analysis, tenantId, companyId });
    return this.analysisStore.promoteCurrent({
      tenantId, companyId, analysisId,
      gate: { checkedAt: new Date(this.now()).toISOString(), citationStatus: "passed", labelRunId: labels.labelRunId },
    });
  }

  _validateEvidenceSet({ linked, evidence, tenantId, companyId, issueId }) {
    if (!Array.isArray(linked) || !Array.isArray(evidence) || linked.length < 1 || linked.length !== evidence.length
      || linked.some((item) => item.tenantId !== tenantId || item.companyId !== companyId || item.issueId !== issueId || item.relationStatus !== "active")) {
      throw new AiConfigurationError("Analysis gate rejected an invalid or cross-scope evidence relation");
    }
    const linkedKeys = new Set(linked.map(evidenceKey));
    const evidenceKeys = new Set(evidence.map(evidenceKey));
    if (linkedKeys.size !== linked.length || evidenceKeys.size !== evidence.length || linkedKeys.size !== evidenceKeys.size
      || [...linkedKeys].some((key) => !evidenceKeys.has(key))) {
      throw new AiConfigurationError("Analysis gate rejected an evidence subset mismatch");
    }
  }

  async _validateFreshCanonicalEvidence(evidence) {
    const source = await this.cmsSourceGate.requirePublishedArticle({ articleId: evidence.sourceArticleId, locale: evidence.locale });
    if (source.sourceArticleId !== evidence.sourceArticleId || source.requestedLocale !== evidence.locale
      || source.canonicalUrl !== evidence.canonicalUrl || source.article.updatedAt !== evidence.updatedAt) {
      throw new AiConfigurationError("Analysis gate rejected stale source or non-canonical citation evidence");
    }
  }

  _validateCitations({ analysis, evidence }) {
    const allowed = new Set(evidence.map((item) => item.sourceArticleId));
    const cited = [...analysis.analysis.impacts, ...analysis.analysis.risks, ...analysis.analysis.watch, ...analysis.analysis.claims];
    if (cited.some((item) => !Array.isArray(item.source_article_ids) || item.source_article_ids.length < 1
      || item.source_article_ids.some((id) => !allowed.has(id)))) {
      throw new AiConfigurationError("Analysis gate rejected an out-of-evidence source article citation");
    }
  }

  _validateLabels({ labels, analysis, tenantId, companyId }) {
    const claimIds = new Set(analysis.analysis.claims.map((claim) => claim.claim_id));
    if (!labels || labels.tenantId !== tenantId || labels.companyId !== companyId || labels.analysisId !== analysis.analysisId
      || !Array.isArray(labels.labels) || labels.labels.length !== claimIds.size
      || new Set(labels.labels.map((item) => item.claim_id)).size !== claimIds.size
      || labels.labels.some((item) => !claimIds.has(item.claim_id) || !["fact", "analysis", "assumption"].includes(item.label))) {
      throw new AiConfigurationError("Analysis gate requires one valid T08 label for each T07 claim");
    }
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "analysis.citation_gate" });
    if (granted !== true) throw new AiConfigurationError("Analysis gate tenant/company authorization was not granted");
  }
}

function evidenceKey(item) {
  const locale = item.locale;
  const updatedAt = item.updatedAt || item.sourceUpdatedAt;
  return `${item.sourceArticleId}|${locale}|${item.canonicalUrl}|${updatedAt || ""}`;
}
function denyByDefault() { throw new AiConfigurationError("Analysis gate requires a tenant/company authorization guard"); }
module.exports = { CitationAnalysisGate };
