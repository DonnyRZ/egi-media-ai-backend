const T04_PROMPT_ID = "T04_issue_match";
const T04_PROMPT_VERSION = "1.0.0";

function createT04PromptDefinition({ modelName }) {
  return {
    promptId: T04_PROMPT_ID,
    version: T04_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.0",
    outputSchemaVersion: "1.0",
    changeSummary: "Choose new or update from a validated, company-scoped active issue candidate set",
    approvedBy: null,
    rollbackVersion: null,
  };
}

module.exports = { T04_PROMPT_ID, T04_PROMPT_VERSION, createT04PromptDefinition };
