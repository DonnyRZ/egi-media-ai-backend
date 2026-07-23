const T03_PROMPT_ID = "T03_relevance_rationale";
const T03_PROMPT_VERSION = "1.0.0";

function createT03PromptDefinition({ modelName }) {
  return {
    promptId: T03_PROMPT_ID,
    version: T03_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.0",
    outputSchemaVersion: "1.0",
    changeSummary: "Optional short explanation of an immutable T02 relevance decision",
    approvedBy: null,
    rollbackVersion: null,
  };
}

module.exports = { T03_PROMPT_ID, T03_PROMPT_VERSION, createT03PromptDefinition };
