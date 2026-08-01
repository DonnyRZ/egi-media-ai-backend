class AiKernelError extends Error {
  constructor(message, { code, retryable = false, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.code = code || "AI_KERNEL_ERROR";
    this.retryable = retryable;
    this.details = details;
  }
}

class AiConfigurationError extends AiKernelError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "AI_CONFIGURATION_INVALID", retryable: false });
  }
}

class AiOutputError extends AiKernelError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || "AI_OUTPUT_INVALID", retryable: false });
  }
}

class AiProviderError extends AiKernelError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || "AI_PROVIDER_ERROR" });
  }
}

function normalizeProviderError(error) {
  if (error instanceof AiKernelError) {
    return error;
  }

  const status = error?.status || error?.statusCode;
  const name = error?.name || "";
  const providerRequestId = error?.request_id || error?._request_id || null;
  const providerError = error?.error || {};
  const providerDetails = {
    status: status || null,
    providerRequestId,
    providerErrorType: providerDetailsValue(providerError.type),
    providerErrorCode: providerDetailsValue(providerError.code),
    ...extractRateLimitDetails(error),
  };

  if (name === "APIConnectionTimeoutError" || status === 408 || /timed out|timeout/i.test(error?.message || "")) {
    return new AiProviderError("OpenAI request timed out", {
      code: "AI_PROVIDER_TIMEOUT",
      retryable: true,
      details: providerDetails,
      cause: error,
    });
  }

  if (name === "APIConnectionError") {
    return new AiProviderError("OpenAI connection failed", {
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
      details: providerDetails,
      cause: error,
    });
  }

  if (status === 429) {
    return new AiProviderError("OpenAI rate limit reached", {
      code: "AI_PROVIDER_RATE_LIMITED",
      retryable: true,
      details: providerDetails,
      cause: error,
    });
  }

  if (typeof status === "number" && status >= 500) {
    return new AiProviderError("OpenAI service is unavailable", {
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
      details: providerDetails,
      cause: error,
    });
  }

  if (status === 401 || status === 403) {
    return new AiProviderError("OpenAI authentication was rejected", {
      code: "AI_PROVIDER_AUTHENTICATION_FAILED",
      retryable: false,
      details: providerDetails,
      cause: error,
    });
  }

  return new AiProviderError("OpenAI request failed", {
    code: "AI_PROVIDER_REJECTED",
    retryable: false,
    details: providerDetails,
    cause: error,
  });
}

function providerDetailsValue(value) {
  return typeof value === "string" && value.length <= 120 ? value : null;
}

function extractRateLimitDetails(error) {
  const headers = error?.headers || error?.response?.headers;
  return {
    retryAfterMs: parseRetryAfterMs(headerValue(headers, "retry-after")),
    resetRequestsMs: parseDurationMs(headerValue(headers, "x-ratelimit-reset-requests")),
    resetTokensMs: parseDurationMs(headerValue(headers, "x-ratelimit-reset-tokens")),
  };
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase());
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseRetryAfterMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, Math.ceil(numeric * 1000));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
}

function parseDurationMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  const text = String(value).trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return Math.max(0, Math.ceil(numeric * 1000));
  const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
  if (!match || !match.slice(1).some(Boolean)) return 0;
  return Math.ceil(((Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0)) * 1000);
}

module.exports = {
  AiKernelError,
  AiConfigurationError,
  AiOutputError,
  AiProviderError,
  normalizeProviderError,
};
