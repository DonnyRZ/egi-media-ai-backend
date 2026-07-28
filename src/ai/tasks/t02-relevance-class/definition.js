const T02_PROMPT_ID = "T02_relevance_class";
const T02_PROMPT_VERSION = "1.2.0";

function createT02PromptDefinition({ modelName }) {
  return {
    promptId: T02_PROMPT_ID,
    version: T02_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.2",
    outputSchemaVersion: "1.0",
    changeSummary: "T02 on mini; rubric tightened; only high/medium continue; optional body snippet; deterministic seed",
    approvedBy: null,
    rollbackVersion: "1.1.0",
  };
}

module.exports = { T02_PROMPT_ID, T02_PROMPT_VERSION, createT02PromptDefinition };
