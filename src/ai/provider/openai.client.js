const OpenAI = require("openai");
const { AiConfigurationError } = require("./provider.errors");

function createOpenAiClient({ apiKey, timeoutMs }) {
  if (!apiKey || typeof apiKey !== "string") {
    throw new AiConfigurationError("OPENAI_API_KEY is not configured");
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new AiConfigurationError("OPENAI_TIMEOUT_MS must be a positive integer");
  }

  return new OpenAI({
    apiKey,
    timeout: timeoutMs,
    // Retry ownership remains in the pipeline policy, never hidden in the SDK.
    maxRetries: 0,
  });
}

module.exports = { createOpenAiClient };
