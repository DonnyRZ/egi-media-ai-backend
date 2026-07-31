const T09_PROMPT_ID = "T09_priority_enum";
const T09_PROMPT_VERSION = "1.1.0";

function createT09PromptDefinition({ modelName }) {
  return {
    promptId: T09_PROMPT_ID,
    version: T09_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.1",
    outputSchemaVersion: "1.0",
    changeSummary: "FULL CONTEXT: leadership identity + company_context fields for priority enum",
    approvedBy: null,
    rollbackVersion: "1.0.0",
  };
}

module.exports = { T09_PROMPT_ID, T09_PROMPT_VERSION, createT09PromptDefinition };
