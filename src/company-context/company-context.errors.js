class CompanyContextError extends Error {
  constructor(message, { code, statusCode = 422, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code || "COMPANY_CONTEXT_ERROR";
    this.statusCode = statusCode;
    this.details = details;
  }
}

class CompanyContextNotFoundError extends CompanyContextError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "NOT_FOUND", statusCode: 404 });
  }
}

class CompanyContextForbiddenError extends CompanyContextError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "FORBIDDEN", statusCode: 403 });
  }
}

class CompanyContextUnauthorizedError extends CompanyContextError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "UNAUTHORIZED", statusCode: 401 });
  }
}

class CompanyContextConflictError extends CompanyContextError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "VERSION_CONFLICT", statusCode: 409 });
  }
}

module.exports = {
  CompanyContextError,
  CompanyContextNotFoundError,
  CompanyContextForbiddenError,
  CompanyContextUnauthorizedError,
  CompanyContextConflictError,
};
