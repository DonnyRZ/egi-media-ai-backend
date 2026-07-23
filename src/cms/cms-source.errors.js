class CmsSourceError extends Error {
  constructor(message, { code, retryable = false, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.code = code || "CMS_SOURCE_ERROR";
    this.retryable = retryable;
    this.details = details;
  }
}

class CmsSourceConfigurationError extends CmsSourceError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "CMS_SOURCE_CONFIGURATION_INVALID" });
  }
}

class CmsSourceGateError extends CmsSourceError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || "CMS_SOURCE_GATE_REJECTED" });
  }
}

module.exports = { CmsSourceError, CmsSourceConfigurationError, CmsSourceGateError };
