const T02_PROMPT_ID = "T02_relevance_class";
const T02_PROMPT_VERSION = "1.9.2";

function createT02PromptDefinition({ modelName }) {
  return {
    promptId: T02_PROMPT_ID,
    version: T02_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.9",
    outputSchemaVersion: "2.0",
    changeSummary: "Deterministic market materiality gate; topic/priority coincidence alone cannot continue",
    approvedBy: null,
    rollbackVersion: "1.8.0",
  };
}

module.exports = { T02_PROMPT_ID, T02_PROMPT_VERSION, createT02PromptDefinition };
