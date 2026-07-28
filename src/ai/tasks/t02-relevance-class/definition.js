const T02_PROMPT_ID = "T02_relevance_class";
const T02_PROMPT_VERSION = "1.7.0";

function createT02PromptDefinition({ modelName }) {
  return {
    promptId: T02_PROMPT_ID,
    version: T02_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.7",
    outputSchemaVersion: "2.0",
    changeSummary: "Reject geographic and customer-segment coincidence without a material market effect",
    approvedBy: null,
    rollbackVersion: "1.6.0",
  };
}

module.exports = { T02_PROMPT_ID, T02_PROMPT_VERSION, createT02PromptDefinition };
