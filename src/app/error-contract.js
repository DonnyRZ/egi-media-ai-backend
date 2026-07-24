const { getRequestId, getCorrelationId } = require("./request-context");
const { safeError } = require("../observability");

const STATUS_BY_CODE = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  NOT_READY: 503,
  AUTHENTICATION_UNAVAILABLE: 503,
  TENANT_CONTEXT_REQUIRED: 400,
  COMPANY_CONTEXT_REQUIRED: 400,
  SCOPE_CONTEXT_UNTRUSTED: 403,
  AI_PROVIDER_RATE_LIMITED: 429,
  AI_PROVIDER_TIMEOUT: 504,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_PROVIDER_AUTHENTICATION_FAILED: 502,
  AI_PROVIDER_REJECTED: 502,
  AI_OUTPUT_INVALID: 502,
  AI_OUTPUT_EMPTY: 502,
  AI_OUTPUT_INVALID_JSON: 502,
  AI_OUTPUT_SCHEMA_INVALID: 502,
  DATABASE_UNAVAILABLE: 503,
  DATABASE_CONSTRAINT: 409,
  DATABASE_QUERY_INVALID: 400,
  CMS_SOURCE_NOT_FOUND: 404,
  CMS_SOURCE_NOT_PUBLISHED: 422,
  CMS_SOURCE_DELETED: 404,
  CMS_SOURCE_ARTICLE_ID_INVALID: 400,
  CMS_SOURCE_LOCALE_INVALID: 400,
  CMS_SOURCE_MALFORMED_ARTICLE: 502,
  CMS_SOURCE_UNAVAILABLE: 503,
  CMS_SOURCE_TIMEOUT: 504,
  CMS_SOURCE_REJECTED: 502,
  CMS_SOURCE_MALFORMED_RESPONSE: 502,
  CMS_SOURCE_CONFIGURATION_INVALID: 503,
  BUSINESS_RULE_FAILED: 422,
  CONFIGURATION_INVALID: 503,
  EMAIL_CONFIGURATION_INVALID: 503,
});

function mapError(error) {
  const code = error?.code;
  if (code && STATUS_BY_CODE[code]) {
    return { status: STATUS_BY_CODE[code], code, message: publicMessage(code), retryable: error.retryable ?? defaultRetryable(code) };
  }

  if (error?.name === "AiConfigurationError" || code === "AI_CONFIGURATION_INVALID") {
    return { status: 503, code: "AI_CONFIGURATION_INVALID", message: "AI service is not configured", retryable: false };
  }

  if (isDatabaseUnavailable(error)) {
    return { status: 503, code: "DATABASE_UNAVAILABLE", message: "Database service is unavailable", retryable: true };
  }

  if (isDatabaseConstraint(error)) {
    return { status: 409, code: "DATABASE_CONSTRAINT", message: "Database constraint rejected the request", retryable: false };
  }

  if (error?.statusCode && error?.code) {
    return { status: error.statusCode, code: error.code, message: error.statusCode >= 500 ? "Internal server error" : error.message, retryable: false };
  }

  return { status: 500, code: "UNKNOWN_INTERNAL_ERROR", message: "Internal server error", retryable: false };
}

function categoryForCode(code = "") {
  if (code.startsWith("AI_PROVIDER") || code.startsWith("AI_OUTPUT") || code.startsWith("AI_")) return "ai";
  if (code.startsWith("DATABASE") || ["23505", "23503", "23514", "23502"].includes(code)) return "database";
  if (code.startsWith("CMS_SOURCE")) return "cms";
  if (code.startsWith("PDF_")) return "pdf";
  if (code.startsWith("EMAIL_")) return "email";
  if (code.includes("AUTH") || code === "FORBIDDEN" || code.includes("SCOPE")) return "security";
  if (code.includes("QUEUE") || code.includes("JOB") || code.includes("PIPELINE")) return "queue";
  if (code.includes("REPORT") || code.includes("REVIEW")) return "report";
  return "application";
}

function defaultRetryable(code) {
  return ["AI_PROVIDER_TIMEOUT", "AI_PROVIDER_RATE_LIMITED", "AI_PROVIDER_UNAVAILABLE", "DATABASE_UNAVAILABLE"].includes(code);
}

function publicMessage(code) {
  const messages = {
    VALIDATION_ERROR: "Request validation failed",
    UNAUTHORIZED: "Authentication is required",
    FORBIDDEN: "Access is forbidden",
    NOT_FOUND: "Resource was not found",
    VERSION_CONFLICT: "Resource version conflict",
    NOT_READY: "Service is not ready",
    AUTHENTICATION_UNAVAILABLE: "Authentication service is unavailable",
    TENANT_CONTEXT_REQUIRED: "Tenant context is required",
    COMPANY_CONTEXT_REQUIRED: "Company context is required",
    SCOPE_CONTEXT_UNTRUSTED: "Trusted tenant and company context is required",
    AI_PROVIDER_RATE_LIMITED: "AI provider rate limit reached",
    AI_PROVIDER_TIMEOUT: "AI provider timed out",
    AI_PROVIDER_UNAVAILABLE: "AI provider is unavailable",
    AI_PROVIDER_AUTHENTICATION_FAILED: "AI provider authentication failed",
    AI_PROVIDER_REJECTED: "AI provider rejected the request",
    AI_OUTPUT_INVALID: "AI output failed validation",
    AI_OUTPUT_EMPTY: "AI output was empty",
    AI_OUTPUT_INVALID_JSON: "AI output was not valid JSON",
    AI_OUTPUT_SCHEMA_INVALID: "AI output failed schema validation",
    DATABASE_UNAVAILABLE: "Database service is unavailable",
    DATABASE_CONSTRAINT: "Database constraint rejected the request",
    DATABASE_QUERY_INVALID: "Database query was invalid",
    CMS_SOURCE_NOT_FOUND: "Source article was not found",
    CMS_SOURCE_NOT_PUBLISHED: "Source article is not published",
    CMS_SOURCE_DELETED: "Source article was deleted",
    CMS_SOURCE_ARTICLE_ID_INVALID: "Source article ID is invalid",
    CMS_SOURCE_LOCALE_INVALID: "Source article locale is invalid",
    CMS_SOURCE_MALFORMED_ARTICLE: "Source article failed validation",
    CMS_SOURCE_UNAVAILABLE: "CMS source is unavailable",
    CMS_SOURCE_TIMEOUT: "CMS source timed out",
    CMS_SOURCE_REJECTED: "CMS source rejected the request",
    CMS_SOURCE_MALFORMED_RESPONSE: "CMS source response was invalid",
    CMS_SOURCE_CONFIGURATION_INVALID: "CMS source is not configured",
    BUSINESS_RULE_FAILED: "Business rule rejected the request",
    CONFIGURATION_INVALID: "Alert eligibility service is not configured",
    EMAIL_CONFIGURATION_INVALID: "Email delivery is not configured",
  };
  return messages[code] || "Request failed";
}

function isDatabaseUnavailable(error) {
  return ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "57P01", "08000", "08001", "08003", "08006"].includes(error?.code);
}

function isDatabaseConstraint(error) {
  return ["23505", "23503", "23514", "23502"].includes(error?.code);
}

function sendError(res, req, error, extraMeta = {}) {
  const mapped = mapError(error);
  if (res.locals) res.locals.errorCode = mapped.code;
  const logger = req.app?.locals?.logger;
  logger?.[mapped.status >= 500 ? "error" : "warn"]?.("http_error_envelope", {
    requestId: getRequestId(req),
    correlationId: getCorrelationId(req),
    method: req.method,
    path: req.path,
    status: mapped.status,
    errorCode: mapped.code,
    category: categoryForCode(mapped.code),
    retryable: mapped.retryable,
    error: safeError(error, { includeMessage: false }),
  });
  return res.status(mapped.status).json({
    success: false,
    error: { code: mapped.code, message: mapped.message },
    meta: {
      request_id: getRequestId(req),
      correlation_id: getCorrelationId(req),
      retryable: mapped.retryable,
      ...extraMeta,
    },
  });
}

function errorMiddleware(error, req, res, _next) {
  if (error?.type === "entity.too.large") return sendError(res, req, Object.assign(error, { code: "PAYLOAD_TOO_LARGE", statusCode: 413 }));
  if (error instanceof SyntaxError && error.status === 400) return sendError(res, req, Object.assign(error, { code: "VALIDATION_ERROR", statusCode: 400 }));
  if (error?.statusCode >= 500 || !error?.statusCode) {
    const logger = req.app?.locals?.logger;
    logger?.error?.("http_request_failed", {
      requestId: getRequestId(req),
      correlationId: getCorrelationId(req),
      method: req.method,
      path: req.path,
      error: safeError(error, { includeMessage: false }),
    });
  }
  return sendError(res, req, error);
}

module.exports = { mapError, sendError, errorMiddleware, isDatabaseUnavailable, isDatabaseConstraint };
