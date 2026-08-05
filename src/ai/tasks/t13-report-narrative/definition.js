const T13_PROMPT_ID = "T13_report_narrative";
const T13_PROMPT_VERSION = "1.2.1";

function createT13PromptDefinition({ modelName }) {
  return {
    promptId: T13_PROMPT_ID,
    version: T13_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.1",
    outputSchemaVersion: "2.0",
    changeSummary: "Type-specific daily, weekly, and monthly management report structure with grounded citations and explicit status/group guidance",
    approvedBy: null,
    rollbackVersion: "1.2.0",
  };
}

module.exports = { T13_PROMPT_ID, T13_PROMPT_VERSION, createT13PromptDefinition };
