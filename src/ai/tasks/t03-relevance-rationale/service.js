const { AiConfigurationError } = require("../../provider/provider.errors");
const { T03_PROMPT_ID, T03_PROMPT_VERSION } = require("./definition");
const { T03_OUTPUT_SCHEMA } = require("./schema");
const { buildT03Input } = require("./prompt");
const { validateT03Output } = require("./output-validator");
const { fingerprint } = require("../t02-relevance-class/service");

class RelevanceRationaleService {
  constructor({ cmsSourceGate, getCompanyContextVersion, promptExecutionService, decisionStore, rationaleStore, authorizeCompany = denyByDefault }) {
    if (!cmsSourceGate?.requirePublishedArticle) throw new AiConfigurationError("T03 requires CMS source gate");
    if (typeof getCompanyContextVersion !== "function") throw new AiConfigurationError("T03 requires Company Context version reader");
    if (!promptExecutionService?.executeActive) throw new AiConfigurationError("T03 requires prompt execution service");
    if (!decisionStore?.getById) throw new AiConfigurationError("T03 requires relevance decision lookup");
    if (!rationaleStore?.get || !rationaleStore?.create) throw new AiConfigurationError("T03 requires rationale store");
    this.cmsSourceGate = cmsSourceGate;
    this.getCompanyContextVersion = getCompanyContextVersion;
    this.promptExecutionService = promptExecutionService;
    this.decisionStore = decisionStore;
    this.rationaleStore = rationaleStore;
    this.authorizeCompany = authorizeCompany;
  }

  async generate({ tenantId = null, companyId, decisionId }) {
    await this._authorizeCompany(companyId);
    const decision = await this.decisionStore.getById(decisionId);
    this._validateDecision(decision, companyId);

    const existing = await this.rationaleStore.get({ decisionId, promptVersion: T03_PROMPT_VERSION });
    if (existing) return { rationale: existing, decision, reused: true };

    const context = await this.getCompanyContextVersion(companyId, decision.contextVersion, tenantId);
    this._validateHistoricalContext(context, companyId, decision.contextVersion);
    const source = await this.cmsSourceGate.requirePublishedArticle({
      articleId: decision.articleId,
      locale: decision.source.requestedLocale,
    });
    if (fingerprint({ source, contextVersion: context.version }) !== decision.inputFingerprint) {
      throw new AiConfigurationError("T03 refuses a rationale when the T02 article snapshot is stale");
    }

    const execution = await this.promptExecutionService.executeActive({
      promptId: T03_PROMPT_ID,
      promptVersion: T03_PROMPT_VERSION,
      model: "nano",
      input: buildT03Input({ companyId, context, decision, source }),
      outputSchema: T03_OUTPUT_SCHEMA,
      budgetScope: { tenantId, companyId },
      validateResult: validateT03Output,
    });
    const rationale = await this.rationaleStore.create({
      decisionId,
      companyId,
      promptVersion: T03_PROMPT_VERSION,
      rationale: execution.data.rationale,
      provenance: execution.provenance,
    });
    return { rationale, decision, reused: false };
  }

  _validateDecision(decision, companyId) {
    if (!decision || decision.companyId !== companyId || !["high", "medium", "low", "none"].includes(decision.relevance)) {
      throw new AiConfigurationError("T03 requires an existing T02 decision for the same company");
    }
  }

  _validateHistoricalContext(context, companyId, version) {
    if (!context || !["effective", "archived"].includes(context.status)
      || context.companyId !== companyId || context.version !== version) {
      throw new AiConfigurationError("T03 requires the Company Context version used by T02");
    }
  }

  async _authorizeCompany(companyId) {
    const granted = await this.authorizeCompany({ companyId, action: "relevance.rationale" });
    if (granted !== true) throw new AiConfigurationError("T03 company authorization was not granted");
  }
}

function denyByDefault() {
  throw new AiConfigurationError("T03 requires a company authorization guard");
}

module.exports = { RelevanceRationaleService };
