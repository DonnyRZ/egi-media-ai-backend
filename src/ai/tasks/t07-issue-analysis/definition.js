const T07_PROMPT_ID = "T07_issue_analysis";
const T07_PROMPT_VERSION = "1.2.0";

function createT07PromptDefinition({ modelName }) {
  return {
    promptId: T07_PROMPT_ID, version: T07_PROMPT_VERSION, status: "active", owner: "ai-engineering",
    modelCompatibility: [modelName], inputSchemaVersion: "1.1", outputSchemaVersion: "3.0",
    changeSummary: "Require subject_relation; forbid internal-ops framing for market/unrelated subjects",
    approvedBy: null, rollbackVersion: "1.1.0",
  };
}

module.exports = { T07_PROMPT_ID, T07_PROMPT_VERSION, createT07PromptDefinition };
