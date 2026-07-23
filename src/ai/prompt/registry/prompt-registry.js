const { normalizePromptDefinition, deepFreeze } = require("./prompt-definition");
const {
  PromptDefinitionError,
  PromptVersionNotFoundError,
  PromptVersionNotActiveError,
  PromptModelNotCompatibleError,
} = require("./prompt-registry.errors");

class PromptRegistry {
  constructor(definitions = []) {
    if (!Array.isArray(definitions)) {
      throw new PromptDefinitionError("Prompt registry definitions must be an array");
    }

    this.definitions = new Map();
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register(definition) {
    const normalized = normalizePromptDefinition(definition);
    const versions = this.definitions.get(normalized.promptId) || new Map();

    if (versions.has(normalized.version)) {
      throw new PromptDefinitionError("Prompt version already exists and is immutable", {
        details: { promptId: normalized.promptId, version: normalized.version },
      });
    }

    if (normalized.status === "active" && [...versions.values()].some((item) => item.status === "active")) {
      throw new PromptDefinitionError("A prompt can have only one active version", {
        details: { promptId: normalized.promptId },
      });
    }

    versions.set(normalized.version, normalized);
    this.definitions.set(normalized.promptId, versions);
    return cloneForRead(normalized);
  }

  getVersion(promptId, version) {
    const definition = this.definitions.get(promptId)?.get(version);
    if (!definition) {
      throw new PromptVersionNotFoundError("Prompt version was not found", {
        details: { promptId, version },
      });
    }

    return cloneForRead(definition);
  }

  requireActive({ promptId, modelName, version }) {
    const versions = this.definitions.get(promptId);
    if (!versions) {
      throw new PromptVersionNotFoundError("Prompt ID was not found", { details: { promptId } });
    }

    const activeDefinition = [...versions.values()].find((item) => item.status === "active");
    if (!activeDefinition) {
      throw new PromptVersionNotActiveError("Prompt has no active version", { details: { promptId } });
    }

    if (version && version !== activeDefinition.version) {
      throw new PromptVersionNotActiveError("Requested prompt version is not active", {
        details: { promptId, version, activeVersion: activeDefinition.version },
      });
    }

    if (!activeDefinition.modelCompatibility.includes(modelName)) {
      throw new PromptModelNotCompatibleError("Active prompt is not compatible with model", {
        details: { promptId, version: activeDefinition.version, modelName },
      });
    }

    return cloneForRead(activeDefinition);
  }

  listVersions(promptId) {
    const versions = this.definitions.get(promptId);
    if (!versions) {
      return [];
    }

    return [...versions.values()].map(cloneForRead);
  }
}

function cloneForRead(value) {
  return deepFreeze(structuredClone(value));
}

module.exports = { PromptRegistry };
