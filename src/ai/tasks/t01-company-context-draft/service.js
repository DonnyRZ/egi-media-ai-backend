const { AiConfigurationError } = require("../../provider/provider.errors");
const { resolveAiOutputLanguage } = require("../../../language/ai-output-language");
const { sanitizeSources } = require("./source-sanitizer");
const { CONTEXT_FIELDS, createT01OutputSchema } = require("./schema");
const { buildT01Input } = require("./prompt");
const { validateT01Output } = require("./output-validator");
const { T01_PROMPT_ID, T01_PROMPT_VERSION } = require("./definition");
const { evaluateContextCompleteness, allMissingFields } = require("../../../company-context/completeness");

class CompanyContextDraftService {
  constructor({ promptExecutionService, draftStore, authorizeCompany = denyByDefault, timeoutMs = null }) {
    if (!promptExecutionService?.executeActive) {
      throw new AiConfigurationError("T01 requires a prompt execution service");
    }
    if (!draftStore?.create) {
      throw new AiConfigurationError("T01 requires a Company Context draft store");
    }
    this.promptExecutionService = promptExecutionService;
    this.draftStore = draftStore;
    this.authorizeCompany = authorizeCompany;
    this.timeoutMs = timeoutMs;
  }

  async createDraft({ trustedContext, sources, tenantId = null }) {
    validateTrustedInput(trustedContext);
    const { companyId, limits } = trustedContext;
    const language = resolveAiOutputLanguage(trustedContext.extractionLanguage);
    const authorized = await this.authorizeCompany({ tenantId, companyId, actor: trustedContext.actor, scopeTrusted: trustedContext.scopeTrusted });
    if (authorized !== true) {
      throw new AiConfigurationError("T01 company authorization was not granted");
    }
    const sanitizedSources = sanitizeSources({ sources, limits });
    const sourceLocators = sanitizedSources.map((source) => source.sourceLocator);
    const outputSchema = createT01OutputSchema(sourceLocators);
    const input = buildT01Input({
      companyId,
      extractionLanguage: language,
      outputLanguage: language,
      allowedFields: CONTEXT_FIELDS,
      limits,
      sources: sanitizedSources,
    });

    const execution = await this.promptExecutionService.executeActive({
      promptId: T01_PROMPT_ID,
      promptVersion: T01_PROMPT_VERSION,
      model: "mini",
      input,
      outputSchema,
      timeoutMs: this.timeoutMs,
      budgetScope: { tenantId, companyId },
      validateResult: (data) => validateT01Output(data, { sourceLocators }),
    });

    const completeness = evaluateContextCompleteness(execution.data.context);
    const result = {
      ...execution.data,
      missing_fields: allMissingFields(execution.data.context),
      completeness,
    };
    const draft = await this.draftStore.create({
      tenantId,
      companyId,
      result,
      sourceFingerprints: sanitizedSources.map((source) => ({
        sourceLocator: source.sourceLocator,
        fingerprint: source.fingerprint,
        metadata: source.metadata || null,
      })),
      provenance: execution.provenance,
    });

    return { draft, provenance: execution.provenance };
  }
}

function denyByDefault() {
  throw new AiConfigurationError("T01 requires a company authorization guard");
}

function validateTrustedInput({ companyId, extractionLanguage }) {
  if (!companyId || typeof companyId !== "string" || companyId.length > 128) {
    throw new AiConfigurationError("T01 requires a validated opaque company ID");
  }
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(extractionLanguage || "")) {
    throw new AiConfigurationError("T01 extraction language must be a valid language tag");
  }
}

module.exports = { CompanyContextDraftService };
