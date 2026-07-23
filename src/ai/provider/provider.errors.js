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

  if (name === "APIConnectionTimeoutError" || status === 408) {
    return new AiProviderError("OpenAI request timed out", {
      code: "AI_PROVIDER_TIMEOUT",
      retryable: true,
      details: { status: status || null, providerRequestId },
      cause: error,
    });
  }

  if (name === "APIConnectionError") {
    return new AiProviderError("OpenAI connection failed", {
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
      details: { status: status || null, providerRequestId },
      cause: error,
    });
  }

  if (status === 429) {
    return new AiProviderError("OpenAI rate limit reached", {
      code: "AI_PROVIDER_RATE_LIMITED",
      retryable: true,
      details: { status, providerRequestId },
      cause: error,
    });
  }

  if (typeof status === "number" && status >= 500) {
    return new AiProviderError("OpenAI service is unavailable", {
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
      details: { status, providerRequestId },
      cause: error,
    });
  }

  if (status === 401 || status === 403) {
    return new AiProviderError("OpenAI authentication was rejected", {
      code: "AI_PROVIDER_AUTHENTICATION_FAILED",
      retryable: false,
      details: { status, providerRequestId },
      cause: error,
    });
  }

  return new AiProviderError("OpenAI request failed", {
    code: "AI_PROVIDER_REJECTED",
    retryable: false,
    details: { status: status || null, providerRequestId },
    cause: error,
  });
}

module.exports = {
  AiKernelError,
  AiConfigurationError,
  AiOutputError,
  AiProviderError,
  normalizeProviderError,
};
