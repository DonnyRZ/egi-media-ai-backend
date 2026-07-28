const T02_PROMPT_ID = "T02_relevance_class";
const T02_PROMPT_VERSION = "1.5.0";

function createT02PromptDefinition({ modelName }) {
  return {
    promptId: T02_PROMPT_ID,
    version: T02_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.5",
    outputSchemaVersion: "2.0",
    changeSummary: "Separate subject identity from management relevance; material external market signals may form issues",
    approvedBy: null,
    rollbackVersion: "1.4.0",
  };
}

module.exports = { T02_PROMPT_ID, T02_PROMPT_VERSION, createT02PromptDefinition };
