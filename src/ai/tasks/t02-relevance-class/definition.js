const T02_PROMPT_ID = "T02_relevance_class";
const T02_PROMPT_VERSION = "1.3.0";

function createT02PromptDefinition({ modelName }) {
  return {
    promptId: T02_PROMPT_ID,
    version: T02_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.3",
    outputSchemaVersion: "2.0",
    changeSummary: "Add subject_relation (self|competitor|market|unrelated); identity gate; only self/listed-competitor form issues",
    approvedBy: null,
    rollbackVersion: "1.2.0",
  };
}

module.exports = { T02_PROMPT_ID, T02_PROMPT_VERSION, createT02PromptDefinition };
