const T06_PROMPT_ID = "T06_issue_oneliner";
const T06_PROMPT_VERSION = "1.1.0";

function createT06PromptDefinition({ modelName }) {
  return {
    promptId: T06_PROMPT_ID, version: T06_PROMPT_VERSION, status: "active", owner: "ai-engineering",
    modelCompatibility: [modelName], inputSchemaVersion: "1.1", outputSchemaVersion: "1.0",
    changeSummary: "Leadership identity stamp (+ light company_context fields) for one-liner framing",
    approvedBy: null, rollbackVersion: "1.0.0",
  };
}

module.exports = { T06_PROMPT_ID, T06_PROMPT_VERSION, createT06PromptDefinition };
