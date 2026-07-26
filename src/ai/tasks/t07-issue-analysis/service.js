const { createHash } = require("crypto");
const { AiConfigurationError } = require("../../provider/provider.errors");
const { loadCompanyOutputLanguage } = require("../../../language/resolve-company-output-language");
const { T07_PROMPT_ID, T07_PROMPT_VERSION } = require("./definition");
const { T07_OUTPUT_SCHEMA } = require("./schema");
const { buildT07Input } = require("./prompt");
const { validateT07Output } = require("./output-validator");

const ACTIVE_STATUSES = new Set(["baru", "berkembang", "dipantau"]);

class IssueAnalysisService {
  constructor({ cmsSourceGate, issueStore, getEffectiveContext, analysisStore, promptExecutionService, companyStore = null, resolveOutputLanguage = null, authorizeCompany = denyByDefault }) {
    if (!cmsSourceGate?.requirePublishedArticle) throw new AiConfigurationError("T07 requires CMS source gate");
    if (!issueStore?.getIssue || !issueStore?.listArticles) throw new AiConfigurationError("T07 requires issue evidence persistence");
    if (typeof getEffectiveContext !== "function") throw new AiConfigurationError("T07 requires effective Company Context reader");
    if (!analysisStore?.get || !analysisStore?.create) throw new AiConfigurationError("T07 requires analysis persistence");
    if (!promptExecutionService?.executeActive) throw new AiConfigurationError("T07 requires prompt execution service");
    Object.assign(this, { cmsSourceGate, issueStore, getEffectiveContext, analysisStore, promptExecutionService, companyStore, resolveOutputLanguage, authorizeCompany });
  }

  async analyze({ tenantId, companyId, issueId }) {
    await this._authorizeCompany({ tenantId, companyId });
    const issue = await this.issueStore.getIssue({ tenantId, companyId, issueId });
    if (!issue || !ACTIVE_STATUSES.has(issue.status)) throw new AiConfigurationError("T07 requires an active issue in the same tenant and company");
    const context = await this.getEffectiveContext(companyId, tenantId);
    if (!context || context.companyId !== companyId || context.status !== "effective" || !Number.isInteger(context.version)) {
      throw new AiConfigurationError("T07 requires an effective Company Context for the same company");
    }
    const linkedArticles = await this.issueStore.listArticles({ tenantId, companyId, issueId });
    // The scoped read is authoritative for the prompt, while the unscoped
    // integrity check detects a corrupted relation that silently disappeared
    // from the requested tenant/company view.
    const allLinkedArticles = await this.issueStore.listArticles({ issueId });
    if (!Array.isArray(allLinkedArticles) || allLinkedArticles.length !== linkedArticles.length) {
      throw new AiConfigurationError("T07 refuses incomplete or cross-scope linked issue evidence");
    }
    this._validateLinkedArticles(linkedArticles, { tenantId, companyId, issueId });
    const evidence = await Promise.all(linkedArticles.map((linked) => this._loadEvidence(linked)));
    const inputFingerprint = fingerprint({ issue, context, evidence });
    const existing = await this.analysisStore.get({ tenantId, companyId, issueId, inputFingerprint, promptVersion: T07_PROMPT_VERSION });
    if (existing) return { analysis: existing, reused: true };
    const allowedArticleIds = new Set(evidence.map((item) => item.sourceArticleId));
    const outputLanguage = await this._resolveOutputLanguage({ tenantId, companyId });
    const execution = await this.promptExecutionService.executeActive({
      promptId: T07_PROMPT_ID, promptVersion: T07_PROMPT_VERSION, model: "mini",
      input: buildT07Input({ tenantId, companyId, issue, context, evidence, outputLanguage }), outputSchema: T07_OUTPUT_SCHEMA,
      budgetScope: { tenantId, companyId },
      validateResult: (data) => validateT07Output(data, { allowedArticleIds }),
    });
    const analysis = await this.analysisStore.create({
      tenantId, companyId, issueId, contextVersion: context.version, inputFingerprint, promptVersion: T07_PROMPT_VERSION,
      analysis: execution.data, evidence, provenance: execution.provenance,
    });
    return { analysis, reused: false };
  }

  async _loadEvidence(linked) {
    const source = await this.cmsSourceGate.requirePublishedArticle({ articleId: linked.sourceArticleId, locale: linked.locale });
    if (source.sourceArticleId !== linked.sourceArticleId || source.requestedLocale !== linked.locale
      || source.article.updatedAt !== linked.sourceUpdatedAt || source.canonicalUrl !== linked.canonicalUrl) {
      throw new AiConfigurationError("T07 refuses stale or mismatched linked article evidence");
    }
    return source;
  }

  _validateLinkedArticles(linkedArticles, { tenantId, companyId, issueId }) {
    if (!Array.isArray(linkedArticles) || linkedArticles.length < 1
      || linkedArticles.some((article) => article.tenantId !== tenantId || article.companyId !== companyId
        || article.issueId !== issueId || article.relationStatus !== "active")) {
      throw new AiConfigurationError("T07 requires active linked issue evidence in the same tenant and company");
    }
    const ids = linkedArticles.map((article) => article.sourceArticleId);
    if (new Set(ids).size !== ids.length) throw new AiConfigurationError("T07 requires unambiguous linked source article IDs");
  }

  async _resolveOutputLanguage({ tenantId, companyId }) {
    if (typeof this.resolveOutputLanguage === "function") {
      return this.resolveOutputLanguage({ tenantId, companyId });
    }
    return loadCompanyOutputLanguage({ companyStore: this.companyStore, tenantId, companyId });
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "issue.analyze" });
    if (granted !== true) throw new AiConfigurationError("T07 tenant/company authorization was not granted");
  }
}

function fingerprint({ issue, context, evidence }) {
  return createHash("sha256").update(JSON.stringify({
    issueId: issue.issueId, issueVersion: issue.version, contextVersion: context.version,
    evidence: evidence.map((item) => ({ id: item.sourceArticleId, locale: item.requestedLocale, updatedAt: item.article.updatedAt, title: item.article.title, summary: item.article.summary, content: item.article.content })),
  })).digest("hex");
}

function denyByDefault() { throw new AiConfigurationError("T07 requires a tenant/company authorization guard"); }

module.exports = { IssueAnalysisService, fingerprint };
