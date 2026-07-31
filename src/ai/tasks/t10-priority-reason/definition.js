const T10_PROMPT_ID = "T10_priority_reason";
const T10_PROMPT_VERSION = "1.1.0";

function createT10PromptDefinition({ modelName }) {
  return {
    promptId: T10_PROMPT_ID,
    version: T10_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.1",
    outputSchemaVersion: "1.0",
    changeSummary: "FULL CONTEXT: leadership identity + company_context fields for priority reason",
    approvedBy: null,
    rollbackVersion: "1.0.0",
  };
}

module.exports = { T10_PROMPT_ID, T10_PROMPT_VERSION, createT10PromptDefinition };
