const T02_PROMPT_ID = "T02_relevance_class";
const T02_PROMPT_VERSION = "1.8.0";

function createT02PromptDefinition({ modelName }) {
  return {
    promptId: T02_PROMPT_ID,
    version: T02_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.8",
    outputSchemaVersion: "2.0",
    changeSummary: "Require an observable event and direct context effect for external market relevance",
    approvedBy: null,
    rollbackVersion: "1.7.0",
  };
}

module.exports = { T02_PROMPT_ID, T02_PROMPT_VERSION, createT02PromptDefinition };
