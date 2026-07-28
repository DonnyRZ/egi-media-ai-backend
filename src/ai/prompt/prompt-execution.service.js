const { randomUUID } = require("crypto");

const { resolveModel } = require("../provider/model.config");
const { AiConfigurationError } = require("../provider/provider.errors");

class PromptExecutionService {
  constructor({ promptRegistry, aiTaskKernel, runStore, openaiConfig, uuid = randomUUID, now = Date.now }) {
    if (!promptRegistry?.requireActive) {
      throw new AiConfigurationError("Prompt registry must expose requireActive");
    }

    if (!aiTaskKernel?.execute) {
      throw new AiConfigurationError("AI task kernel must expose execute");
    }

    if (!runStore?.record) {
      throw new AiConfigurationError("Prompt run store must expose record");
    }

    this.promptRegistry = promptRegistry;
    this.aiTaskKernel = aiTaskKernel;
    this.runStore = runStore;
    this.openaiConfig = openaiConfig;
    this.uuid = uuid;
    this.now = now;
  }

  async executeActive({ promptId, promptVersion, model, input, outputSchema, timeoutMs, validateResult, budgetScope = null, seed = null }) {
    const modelName = resolveModel(model, this.openaiConfig);
    const prompt = this.promptRegistry.requireActive({
      promptId,
      version: promptVersion,
      modelName,
    });
    const runId = this.uuid();
    const requestId = this.uuid();
    const startedAt = this.now();

    try {
      const result = await this.aiTaskKernel.execute({
        model,
        input,
        outputSchema,
        requestId,
        timeoutMs,
        budgetScope,
        seed,
      });
      const data = validateResult ? validateResult(result.data) : result.data;
      const provenance = this.runStore.record({
        runId,
        promptId: prompt.promptId,
        promptVersion: prompt.version,
        model: result.model.name,
        modelAlias: result.model.alias,
        latencyMs: result.latencyMs,
        usage: result.usage,
        validationOutcome: "passed",
        status: "succeeded",
        requestId: result.correlation.requestId,
        providerRequestId: result.correlation.providerRequestId,
        providerResponseId: result.providerResponseId,
        createdAt: new Date(startedAt).toISOString(),
      });

      return { ...result, data, prompt: { id: prompt.promptId, version: prompt.version }, provenance };
    } catch (error) {
      this.runStore.record({
        runId,
        promptId: prompt.promptId,
        promptVersion: prompt.version,
        model: modelName,
        modelAlias: model,
        latencyMs: this.now() - startedAt,
        usage: null,
        validationOutcome: error.code?.startsWith("AI_OUTPUT_") ? "failed" : "not_run",
        status: "failed",
        requestId,
        providerRequestId: error.details?.providerRequestId || null,
        providerResponseId: null,
        error: { code: error.code || "AI_EXECUTION_FAILED", retryable: Boolean(error.retryable) },
        createdAt: new Date(startedAt).toISOString(),
      });
      throw error;
    }
  }
}

module.exports = { PromptExecutionService };
