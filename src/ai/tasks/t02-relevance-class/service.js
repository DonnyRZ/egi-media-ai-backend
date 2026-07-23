const { createHash } = require("crypto");

const { AiConfigurationError } = require("../../provider/provider.errors");
const { T02_PROMPT_ID, T02_PROMPT_VERSION } = require("./definition");
const { T02_OUTPUT_SCHEMA } = require("./schema");
const { buildT02Input } = require("./prompt");
const { validateT02Output } = require("./output-validator");

class RelevanceClassificationService {
  constructor({ cmsSourceGate, getEffectiveContext, promptExecutionService, decisionStore, authorizeCompany = denyByDefault }) {
    if (!cmsSourceGate?.requirePublishedArticle) throw new AiConfigurationError("T02 requires CMS source gate");
    if (typeof getEffectiveContext !== "function") throw new AiConfigurationError("T02 requires effective Company Context reader");
    if (!promptExecutionService?.executeActive) throw new AiConfigurationError("T02 requires prompt execution service");
    if (!decisionStore?.get || !decisionStore?.create) throw new AiConfigurationError("T02 requires relevance decision store");
    this.cmsSourceGate = cmsSourceGate;
    this.getEffectiveContext = getEffectiveContext;
    this.promptExecutionService = promptExecutionService;
    this.decisionStore = decisionStore;
    this.authorizeCompany = authorizeCompany;
  }

  async classify({ companyId, articleId, locale }) {
    await this._authorizeCompany(companyId);
    const context = await this.getEffectiveContext(companyId);
    this._validateEffectiveContext(context, companyId);
    const source = await this.cmsSourceGate.requirePublishedArticle({ articleId, locale });
    const inputFingerprint = fingerprint({ source, contextVersion: context.version });
    const existing = this.decisionStore.get({ articleId, companyId, contextVersion: context.version, inputFingerprint });
    if (existing) return { decision: existing, reused: true, shouldContinue: existing.branch === "continue" };

    const execution = await this.promptExecutionService.executeActive({
      promptId: T02_PROMPT_ID,
      promptVersion: T02_PROMPT_VERSION,
      model: "nano",
      input: buildT02Input({ companyId, context, source }),
      outputSchema: T02_OUTPUT_SCHEMA,
      validateResult: validateT02Output,
    });
    const decision = this.decisionStore.create({
      articleId,
      companyId,
      contextVersion: context.version,
      inputFingerprint,
      source,
      output: execution.data,
      provenance: execution.provenance,
    });

    return { decision, reused: false, shouldContinue: decision.branch === "continue" };
  }

  _validateEffectiveContext(context, companyId) {
    if (!context || context.status !== "effective" || context.companyId !== companyId || !Number.isInteger(context.version)) {
      throw new AiConfigurationError("T02 requires an approved effective Company Context for the same company");
    }
  }

  async _authorizeCompany(companyId) {
    const granted = await this.authorizeCompany({ companyId, action: "relevance.classify" });
    if (granted !== true) throw new AiConfigurationError("T02 company authorization was not granted");
  }
}

function fingerprint({ source, contextVersion }) {
  const value = JSON.stringify({
    articleId: source.sourceArticleId,
    requestedLocale: source.requestedLocale,
    contentLocale: source.contentLocale,
    publishedAt: source.article.publishedAt,
    updatedAt: source.article.updatedAt,
    title: source.article.title,
    summary: source.article.summary,
    contextVersion,
  });
  return createHash("sha256").update(value).digest("hex");
}

function denyByDefault() {
  throw new AiConfigurationError("T02 requires a company authorization guard");
}

module.exports = { RelevanceClassificationService, fingerprint };
