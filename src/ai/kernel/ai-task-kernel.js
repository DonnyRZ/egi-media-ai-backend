const Ajv = require("ajv");
const { randomUUID } = require("crypto");

const { resolveModel } = require("../provider/model.config");
const {
  AiConfigurationError,
  AiOutputError,
  normalizeProviderError,
} = require("../provider/provider.errors");

class AiTaskKernel {
  constructor({ openaiClient, openaiConfig, defaultTimeoutMs, uuid = randomUUID, budgetGate = null, rateLimiter = null, outputTokenReserve = 1000, logger = null }) {
    if (!openaiClient?.responses?.create) {
      throw new AiConfigurationError("OpenAI client must expose responses.create");
    }

    if (!openaiConfig || typeof openaiConfig !== "object") {
      throw new AiConfigurationError("OpenAI model configuration is required");
    }

    if (!Number.isInteger(defaultTimeoutMs) || defaultTimeoutMs <= 0) {
      throw new AiConfigurationError("AI task timeout must be a positive integer");
    }

    this.openaiClient = openaiClient;
    this.openaiConfig = openaiConfig;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.uuid = uuid;
    this.budgetGate = budgetGate;
    this.rateLimiter = rateLimiter;
    this.outputTokenReserve = Number.isFinite(Number(outputTokenReserve)) ? Math.max(0, Math.ceil(Number(outputTokenReserve))) : 1000;
    this.logger = logger || { debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
    this.ajv = new Ajv({ allErrors: true, strict: false });
  }

  async execute({ model, input, outputSchema, requestId, timeoutMs, budgetScope = null, seed = null }) {
    this._validateInput({ input, outputSchema, timeoutMs });

    const resolvedModel = resolveModel(model, this.openaiConfig);
    const correlationId = requestId || this.uuid();
    const resolvedTimeoutMs = timeoutMs || this.defaultTimeoutMs;
    const validateOutput = this._compileSchema(outputSchema.schema);
    const startedAt = Date.now();
    this.logger.info("ai_task_started", { requestId: correlationId, modelAlias: model, model: resolvedModel, outputSchema: outputSchema.name, timeoutMs: resolvedTimeoutMs });

    let response;
    let rateLimitLease;
    try {
      this.budgetGate?.beforeRequest(budgetScope);
      rateLimitLease = await this.rateLimiter?.acquire({ model: resolvedModel, estimatedTokens: estimateTokens(input, this.outputTokenReserve) });
      const requestBody = {
        model: resolvedModel,
        input,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: outputSchema.name,
            strict: true,
            schema: outputSchema.schema,
          },
        },
      };
      if (Number.isInteger(seed)) requestBody.seed = seed;
      response = await this.openaiClient.responses.create(
        requestBody,
        {
          timeout: resolvedTimeoutMs,
          headers: { "X-Client-Request-Id": correlationId },
        },
      );
    } catch (error) {
      const normalized = normalizeProviderError(error);
      if (normalized.code === "AI_PROVIDER_RATE_LIMITED") {
        this.rateLimiter?.observeRateLimit({ model: resolvedModel, ...normalized.details });
      }
      rateLimitLease?.release();
      this.logger.error("ai_task_failed", { requestId: correlationId, modelAlias: model, model: resolvedModel, outputSchema: outputSchema.name, durationMs: Date.now() - startedAt, error: normalized });
      throw normalized;
    }

    const usage = normalizeUsage(response.usage);
    rateLimitLease?.release({ actualTokens: usage?.totalTokens });

    let data;
    try {
      data = this._parseAndValidateOutput(response, validateOutput);
    } catch (error) {
      this.logger.error("ai_output_rejected", { requestId: correlationId, providerRequestId: response?._request_id || null, providerResponseId: response?.id || null, modelAlias: model, outputSchema: outputSchema.name, durationMs: Date.now() - startedAt, error });
      throw error;
    }
    this.budgetGate?.recordUsage(usage, budgetScope);

    this.logger.info("ai_task_succeeded", { requestId: correlationId, providerRequestId: response._request_id || null, providerResponseId: response.id || null, modelAlias: model, model: resolvedModel, outputSchema: outputSchema.name, durationMs: Date.now() - startedAt, usage });

    return {
      data,
      correlation: {
        requestId: correlationId,
        providerRequestId: response._request_id || null,
      },
      model: { alias: model, name: resolvedModel },
      providerResponseId: response.id || null,
      usage,
      latencyMs: Date.now() - startedAt,
    };
  }

  _validateInput({ input, outputSchema, timeoutMs }) {
    if (!(typeof input === "string" || Array.isArray(input))) {
      throw new AiConfigurationError("AI input must be a string or Responses input array");
    }

    if (!outputSchema || typeof outputSchema !== "object") {
      throw new AiConfigurationError("Structured output schema is required");
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(outputSchema.name || "")) {
      throw new AiConfigurationError("Structured output schema name is invalid");
    }

    if (!outputSchema.schema || typeof outputSchema.schema !== "object") {
      throw new AiConfigurationError("Structured output JSON Schema is required");
    }

    if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
      throw new AiConfigurationError("AI task timeout must be a positive integer");
    }
  }

  _compileSchema(schema) {
    try {
      return this.ajv.compile(schema);
    } catch (error) {
      throw new AiConfigurationError("Structured output JSON Schema is invalid", {
        cause: error,
      });
    }
  }

  _parseAndValidateOutput(response, validateOutput) {
    const outputText = response?.output_text;
    if (!outputText || typeof outputText !== "string") {
      throw new AiOutputError("OpenAI response did not include structured output text", {
        code: "AI_OUTPUT_EMPTY",
        details: { providerRequestId: response?._request_id || null },
      });
    }

    let data;
    try {
      data = JSON.parse(outputText);
    } catch (_error) {
      throw new AiOutputError("OpenAI response is not valid JSON", {
        code: "AI_OUTPUT_INVALID_JSON",
        details: { providerRequestId: response?._request_id || null },
      });
    }

    if (!validateOutput(data)) {
      throw new AiOutputError("OpenAI response failed local JSON Schema validation", {
        code: "AI_OUTPUT_SCHEMA_INVALID",
        details: {
          providerRequestId: response?._request_id || null,
          validationErrors: validateOutput.errors || [],
        },
      });
    }

    return data;
  }
}

function normalizeUsage(usage) {
  if (!usage) {
    return null;
  }

  return {
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  };
}

function estimateTokens(input, outputTokenReserve) {
  const serialized = typeof input === "string" ? input : JSON.stringify(input);
  return Math.ceil((serialized?.length || 0) / 4) + outputTokenReserve;
}

module.exports = { AiTaskKernel };
