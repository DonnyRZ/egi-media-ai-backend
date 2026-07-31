const T05_PROMPT_ID = "T05_issue_title";
const T05_PROMPT_VERSION = "1.1.0";

function createT05PromptDefinition({ modelName }) {
  return {
    promptId: T05_PROMPT_ID,
    version: T05_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.1",
    outputSchemaVersion: "1.0",
    changeSummary: "Leadership identity stamp (+ light company_context fields) for title framing",
    approvedBy: null,
    rollbackVersion: "1.0.0",
  };
}

module.exports = { T05_PROMPT_ID, T05_PROMPT_VERSION, createT05PromptDefinition };
