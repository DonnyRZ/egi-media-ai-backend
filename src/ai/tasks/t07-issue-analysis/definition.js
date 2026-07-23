const T07_PROMPT_ID = "T07_issue_analysis";
const T07_PROMPT_VERSION = "1.0.0";

function createT07PromptDefinition({ modelName }) {
  return {
    promptId: T07_PROMPT_ID, version: T07_PROMPT_VERSION, status: "active", owner: "ai-engineering",
    modelCompatibility: [modelName], inputSchemaVersion: "1.0", outputSchemaVersion: "1.0",
    changeSummary: "Create a cited issue analysis from linked issue evidence only",
    approvedBy: null, rollbackVersion: null,
  };
}

module.exports = { T07_PROMPT_ID, T07_PROMPT_VERSION, createT07PromptDefinition };
