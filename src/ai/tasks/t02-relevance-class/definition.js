const T02_PROMPT_ID = "T02_relevance_class";
const T02_PROMPT_VERSION = "1.16.0";

function createT02PromptDefinition({ modelName }) {
  return {
    promptId: T02_PROMPT_ID,
    version: T02_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.13",
    outputSchemaVersion: "2.0",
    changeSummary: "FULL CONTEXT: generic context-event bridges for concrete quality, platform, climate, education, and infrastructure signals",
    approvedBy: null,
    rollbackVersion: "1.9.2",
  };
}

module.exports = { T02_PROMPT_ID, T02_PROMPT_VERSION, createT02PromptDefinition };
