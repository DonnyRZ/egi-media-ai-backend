class PromptRegistryError extends Error {
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code || "PROMPT_REGISTRY_ERROR";
    this.details = details;
  }
}

class PromptDefinitionError extends PromptRegistryError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "PROMPT_DEFINITION_INVALID" });
  }
}

class PromptVersionNotFoundError extends PromptRegistryError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "PROMPT_VERSION_NOT_FOUND" });
  }
}

class PromptVersionNotActiveError extends PromptRegistryError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "PROMPT_VERSION_NOT_ACTIVE" });
  }
}

class PromptModelNotCompatibleError extends PromptRegistryError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "PROMPT_MODEL_NOT_COMPATIBLE" });
  }
}

module.exports = {
  PromptRegistryError,
  PromptDefinitionError,
  PromptVersionNotFoundError,
  PromptVersionNotActiveError,
  PromptModelNotCompatibleError,
};
