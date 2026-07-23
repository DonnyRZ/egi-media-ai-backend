const T01_PROMPT_ID = "T01_company_context_draft";
const T01_PROMPT_VERSION = "1.0.0";

function createT01PromptDefinition({ modelName }) {
  return {
    promptId: T01_PROMPT_ID,
    version: T01_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.0",
    outputSchemaVersion: "1.0",
    changeSummary: "Initial Company Context draft-only extraction contract",
    approvedBy: null,
    rollbackVersion: null,
  };
}

module.exports = { T01_PROMPT_ID, T01_PROMPT_VERSION, createT01PromptDefinition };
