const T02_PROMPT_ID = "T02_relevance_class";
const T02_PROMPT_VERSION = "1.11.0";

function createT02PromptDefinition({ modelName }) {
  return {
    promptId: T02_PROMPT_ID,
    version: T02_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.11",
    outputSchemaVersion: "2.0",
    changeSummary: "FULL CONTEXT: explicit adjacency and direct-regulator materiality boundaries",
    approvedBy: null,
    rollbackVersion: "1.9.2",
  };
}

module.exports = { T02_PROMPT_ID, T02_PROMPT_VERSION, createT02PromptDefinition };
