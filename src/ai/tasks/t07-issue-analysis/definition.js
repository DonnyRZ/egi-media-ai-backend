const T07_PROMPT_ID = "T07_issue_analysis";
const T07_PROMPT_VERSION = "1.1.0";

function createT07PromptDefinition({ modelName }) {
  return {
    promptId: T07_PROMPT_ID, version: T07_PROMPT_VERSION, status: "active", owner: "ai-engineering",
    modelCompatibility: [modelName], inputSchemaVersion: "1.0", outputSchemaVersion: "2.0",
    changeSummary: "Emit what_happened and why_matters as concise point arrays for the issue drawer",
    approvedBy: null, rollbackVersion: "1.0.0",
  };
}

module.exports = { T07_PROMPT_ID, T07_PROMPT_VERSION, createT07PromptDefinition };
