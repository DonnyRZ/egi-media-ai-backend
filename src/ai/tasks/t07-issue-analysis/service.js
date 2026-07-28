const { createHash } = require("crypto");
const { AiConfigurationError } = require("../../provider/provider.errors");
const { loadCompanyOutputLanguage } = require("../../../language/resolve-company-output-language");
const {
  T07_PROMPT_ID,
  T07_PROMPT_VERSION,
  T07_REVIEW_PROMPT_ID,
  T07_REVIEW_PROMPT_VERSION,
} = require("./definition");
const { T07_OUTPUT_SCHEMA } = require("./schema");
const { buildT07Input } = require("./prompt");
const { validateT07Output } = require("./output-validator");
const { applySubjectIdentityGate } = require("../t02-relevance-class/subject-identity-gate");
const {
  T07_PERSPECTIVE_REVIEW_SCHEMA,
  buildPerspectiveReviewInput,
  validatePerspectiveReview,
} = require("./perspective-review");

const ACTIVE_STATUSES = new Set(["baru", "berkembang", "dipantau"]);
const RELATION_RANK = Object.freeze({ unrelated: 0, market: 1, competitor: 2, self: 3 });

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
    const allLinkedArticles = await this.issueStore.listArticles({ issueId });
    if (!Array.isArray(allLinkedArticles) || allLinkedArticles.length !== linkedArticles.length) {
      throw new AiConfigurationError("T07 refuses incomplete or cross-scope linked issue evidence");
    }
    this._validateLinkedArticles(linkedArticles, { tenantId, companyId, issueId });
    const evidence = await Promise.all(linkedArticles.map((linked) => this._loadEvidence(linked)));
    const subjectRelation = resolveIssueSubjectRelation(context.fields, evidence);
    const inputFingerprint = fingerprint({ issue, context, evidence, subjectRelation });
    const existing = await this.analysisStore.get({ tenantId, companyId, issueId, inputFingerprint, promptVersion: T07_PROMPT_VERSION });
    if (existing) return { analysis: existing, reused: true };
    const allowedArticleIds = new Set(evidence.map((item) => item.sourceArticleId));
    const outputLanguage = await this._resolveOutputLanguage({ tenantId, companyId });
    const execution = await this.promptExecutionService.executeActive({
      promptId: T07_PROMPT_ID, promptVersion: T07_PROMPT_VERSION, model: "mini",
      input: buildT07Input({ tenantId, companyId, issue, context, evidence, outputLanguage, subjectRelation }), outputSchema: T07_OUTPUT_SCHEMA,
      budgetScope: { tenantId, companyId },
      validateResult: (data) => validateT07Output(data, { allowedArticleIds, expectedSubjectRelation: subjectRelation }),
    });
    const review = await this.promptExecutionService.executeActive({
      promptId: T07_REVIEW_PROMPT_ID,
      promptVersion: T07_REVIEW_PROMPT_VERSION,
      model: "mini",
      input: buildPerspectiveReviewInput({
        tenantId,
        companyId,
        context,
        evidence,
        outputLanguage,
        subjectRelation,
        candidate: execution.data,
      }),
      outputSchema: T07_PERSPECTIVE_REVIEW_SCHEMA,
      budgetScope: { tenantId, companyId },
      validateResult: (data) => validatePerspectiveReview(data, {
        allowedArticleIds,
        expectedSubjectRelation: subjectRelation,
      }),
    });
    const reviewedAnalysis = review.data.verdict === "corrected"
      ? review.data.corrected_analysis
      : execution.data;
    const analysis = await this.analysisStore.create({
      tenantId, companyId, issueId, contextVersion: context.version, inputFingerprint, promptVersion: T07_PROMPT_VERSION,
      analysis: reviewedAnalysis,
      evidence,
      provenance: {
        ...execution.provenance,
        subjectRelation,
        managementPerspectiveReview: {
          promptId: T07_REVIEW_PROMPT_ID,
          promptVersion: T07_REVIEW_PROMPT_VERSION,
          verdict: review.data.verdict,
          violations: review.data.violations,
          provenance: review.provenance,
        },
      },
    });
    return { analysis, reused: false };
  }

  async _loadEvidence(linked) {
    const source = await this.cmsSourceGate.requirePublishedArticle({ articleId: linked.sourceArticleId, locale: linked.locale });
    const linkedUpdatedAt = normalizeEvidenceUpdatedAt(linked.sourceUpdatedAt);
    const liveUpdatedAt = normalizeEvidenceUpdatedAt(source.article.updatedAt);
    const idOk = source.sourceArticleId === linked.sourceArticleId;
    const localeOk = source.requestedLocale === linked.locale;
    const updatedOk = liveUpdatedAt === linkedUpdatedAt;
    const urlOk = source.canonicalUrl === linked.canonicalUrl;
    if (!idOk || !localeOk || !updatedOk || !urlOk) {
      throw new AiConfigurationError("T07 refuses stale or mismatched linked article evidence", {
        details: {
          sourceArticleId: linked.sourceArticleId,
          mismatches: {
            sourceArticleId: !idOk,
            locale: !localeOk,
            updatedAt: !updatedOk,
            canonicalUrl: !urlOk,
          },
          linked: { locale: linked.locale, sourceUpdatedAt: linked.sourceUpdatedAt ?? null, canonicalUrl: linked.canonicalUrl },
          live: { locale: source.requestedLocale, updatedAt: source.article.updatedAt ?? null, canonicalUrl: source.canonicalUrl },
        },
      });
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

function resolveIssueSubjectRelation(fields, evidence) {
  const relations = evidence.map((item) => applySubjectIdentityGate({
    relevance: "medium",
    confidence: 0.5,
    subjectRelation: "unrelated",
    fields,
    title: item.article?.title,
    summary: item.article?.summary,
    body: item.article?.content,
  }).subjectRelation);
  return relations.sort((a, b) => RELATION_RANK[b] - RELATION_RANK[a])[0] || "unrelated";
}

function fingerprint({ issue, context, evidence, subjectRelation }) {
  return createHash("sha256").update(JSON.stringify({
    issueId: issue.issueId, issueVersion: issue.version, contextVersion: context.version,
    subjectRelation,
    evidence: evidence.map((item) => ({ id: item.sourceArticleId, locale: item.requestedLocale, updatedAt: item.article.updatedAt, title: item.article.title, summary: item.article.summary, content: item.article.content })),
  })).digest("hex");
}

function normalizeEvidenceUpdatedAt(value) {
  return value === undefined ? null : value;
}

function denyByDefault() { throw new AiConfigurationError("T07 requires a tenant/company authorization guard"); }

module.exports = { IssueAnalysisService, fingerprint, normalizeEvidenceUpdatedAt, resolveIssueSubjectRelation };
