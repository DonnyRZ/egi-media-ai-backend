const T03_PROMPT_ID = "T03_relevance_rationale";
const T03_PROMPT_VERSION = "1.1.0";

function createT03PromptDefinition({ modelName }) {
  return {
    promptId: T03_PROMPT_ID,
    version: T03_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.1",
    outputSchemaVersion: "1.0",
    changeSummary: "FULL CONTEXT: leadership identity + company_context fields on rationale",
    approvedBy: null,
    rollbackVersion: "1.0.0",
  };
}

module.exports = { T03_PROMPT_ID, T03_PROMPT_VERSION, createT03PromptDefinition };
