const T05_PROMPT_ID = "T05_issue_title";
const T05_PROMPT_VERSION = "1.0.0";

function createT05PromptDefinition({ modelName }) {
  return {
    promptId: T05_PROMPT_ID,
    version: T05_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.0",
    outputSchemaVersion: "1.0",
    changeSummary: "Generate one bounded title for an active issue that has no title",
    approvedBy: null,
    rollbackVersion: null,
  };
}

module.exports = { T05_PROMPT_ID, T05_PROMPT_VERSION, createT05PromptDefinition };
