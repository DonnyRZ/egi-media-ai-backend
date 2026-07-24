const { normalizeProviderError } = require("../../src/ai/provider/provider.errors");

class OpenAiIntegrationBudget {
  constructor({ maxRequests = 2, maxTokens = 8000 } = {}) {
    this.maxRequests = positiveInteger(maxRequests, "maxRequests");
    this.maxTokens = positiveInteger(maxTokens, "maxTokens");
    this.requests = 0;
    this.totalTokens = 0;
  }

  reserveRequest(model) {
    if (this.requests >= this.maxRequests) {
      throw new Error(`S24 request budget exceeded before ${model} request`);
    }
    this.requests += 1;
  }

  recordUsage(usage, model) {
    const totalTokens = Number(usage?.totalTokens ?? usage?.total_tokens ?? 0);
    if (!Number.isFinite(totalTokens) || totalTokens < 0) {
      throw new Error(`S24 received invalid token usage for ${model}`);
    }
    this.totalTokens += totalTokens;
    if (this.totalTokens > this.maxTokens) {
      throw new Error(`S24 token budget exceeded after ${model} request`);
    }
  }
}

async function withRetry(operation, { maxAttempts = 2, sleep = async () => {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = normalizeProviderError(error);
      if (!lastError.retryable || attempt === maxAttempts) throw lastError;
      await sleep(attempt);
    }
  }
  throw lastError;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`S24 ${name} must be a positive integer`);
  return value;
}

module.exports = { OpenAiIntegrationBudget, withRetry };
