const T02_PROMPT_ID = "T02_relevance_class";
const T02_PROMPT_VERSION = "1.0.0";

function createT02PromptDefinition({ modelName }) {
  return {
    promptId: T02_PROMPT_ID,
    version: T02_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.0",
    outputSchemaVersion: "1.0",
    changeSummary: "Initial relevance-only classification for one article snapshot and one effective Company Context version",
    approvedBy: null,
    rollbackVersion: null,
  };
}

module.exports = { T02_PROMPT_ID, T02_PROMPT_VERSION, createT02PromptDefinition };
