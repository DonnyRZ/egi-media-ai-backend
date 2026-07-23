const { AiConfigurationError } = require("../../provider/provider.errors");
const { sanitizeSources } = require("./source-sanitizer");
const { CONTEXT_FIELDS, createT01OutputSchema } = require("./schema");
const { buildT01Input } = require("./prompt");
const { validateT01Output } = require("./output-validator");
const { T01_PROMPT_ID, T01_PROMPT_VERSION } = require("./definition");

class CompanyContextDraftService {
  constructor({ promptExecutionService, draftStore, authorizeCompany = denyByDefault }) {
    if (!promptExecutionService?.executeActive) {
      throw new AiConfigurationError("T01 requires a prompt execution service");
    }
    if (!draftStore?.create) {
      throw new AiConfigurationError("T01 requires a Company Context draft store");
    }
    this.promptExecutionService = promptExecutionService;
    this.draftStore = draftStore;
    this.authorizeCompany = authorizeCompany;
  }

  async createDraft({ trustedContext, sources }) {
    validateTrustedInput(trustedContext);
    const { companyId, extractionLanguage, limits } = trustedContext;
    const authorized = await this.authorizeCompany({ companyId });
    if (authorized !== true) {
      throw new AiConfigurationError("T01 company authorization was not granted");
    }
    const sanitizedSources = sanitizeSources({ sources, limits });
    const sourceLocators = sanitizedSources.map((source) => source.sourceLocator);
    const outputSchema = createT01OutputSchema(sourceLocators);
    const input = buildT01Input({
      companyId,
      extractionLanguage,
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
      validateResult: (data) => validateT01Output(data, { sourceLocators }),
    });

    const draft = this.draftStore.create({
      companyId,
      result: execution.data,
      sourceFingerprints: sanitizedSources.map((source) => ({
        sourceLocator: source.sourceLocator,
        fingerprint: source.fingerprint,
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
