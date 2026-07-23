const { PromptDefinitionError } = require("./prompt-registry.errors");

const PROMPT_STATUSES = Object.freeze(["draft", "review", "approved", "active"]);
const PROMPT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,127}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function normalizePromptDefinition(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new PromptDefinitionError("Prompt definition must be an object");
  }

  const normalized = {
    promptId: definition.promptId,
    version: definition.version,
    status: definition.status,
    owner: definition.owner,
    modelCompatibility: definition.modelCompatibility,
    inputSchemaVersion: definition.inputSchemaVersion,
    outputSchemaVersion: definition.outputSchemaVersion,
    changeSummary: definition.changeSummary,
    approvedBy: definition.approvedBy ?? null,
    rollbackVersion: definition.rollbackVersion ?? null,
  };

  if (!PROMPT_ID_PATTERN.test(normalized.promptId || "")) {
    throw new PromptDefinitionError("Prompt ID is invalid", { details: { promptId: normalized.promptId } });
  }

  if (!SEMVER_PATTERN.test(normalized.version || "")) {
    throw new PromptDefinitionError("Prompt version must use semantic versioning", {
      details: { version: normalized.version },
    });
  }

  if (!PROMPT_STATUSES.includes(normalized.status)) {
    throw new PromptDefinitionError("Prompt status is invalid", { details: { status: normalized.status } });
  }

  for (const field of ["owner", "inputSchemaVersion", "outputSchemaVersion", "changeSummary"]) {
    if (!normalized[field] || typeof normalized[field] !== "string") {
      throw new PromptDefinitionError(`Prompt ${field} is required`);
    }
  }

  if (!Array.isArray(normalized.modelCompatibility) || normalized.modelCompatibility.length === 0
    || normalized.modelCompatibility.some((model) => typeof model !== "string" || !model)) {
    throw new PromptDefinitionError("Prompt modelCompatibility must contain model IDs");
  }

  if (normalized.approvedBy !== null && typeof normalized.approvedBy !== "string") {
    throw new PromptDefinitionError("Prompt approvedBy must be a string or null");
  }

  if (normalized.rollbackVersion !== null && !SEMVER_PATTERN.test(normalized.rollbackVersion)) {
    throw new PromptDefinitionError("Prompt rollbackVersion must be a semantic version or null");
  }

  return deepFreeze(structuredClone(normalized));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
  }

  return value;
}

module.exports = { PROMPT_STATUSES, normalizePromptDefinition, deepFreeze };
