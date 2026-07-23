const T10_PROMPT_ID = "T10_priority_reason";
const T10_PROMPT_VERSION = "1.0.0";

function createT10PromptDefinition({ modelName }) {
  return {
    promptId: T10_PROMPT_ID,
    version: T10_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.0",
    outputSchemaVersion: "1.0",
    changeSummary: "Write a grounded bounded reason for an immutable T09 priority decision",
    approvedBy: null,
    rollbackVersion: null,
  };
}

module.exports = { T10_PROMPT_ID, T10_PROMPT_VERSION, createT10PromptDefinition };
