const T06_PROMPT_ID = "T06_issue_oneliner";
const T06_PROMPT_VERSION = "1.0.0";

function createT06PromptDefinition({ modelName }) {
  return {
    promptId: T06_PROMPT_ID, version: T06_PROMPT_VERSION, status: "active", owner: "ai-engineering",
    modelCompatibility: [modelName], inputSchemaVersion: "1.0", outputSchemaVersion: "1.0",
    changeSummary: "Generate one bounded one-liner for an active issue with a valid title",
    approvedBy: null, rollbackVersion: null,
  };
}

module.exports = { T06_PROMPT_ID, T06_PROMPT_VERSION, createT06PromptDefinition };
