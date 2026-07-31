const T13_PROMPT_ID = "T13_report_narrative";
const T13_PROMPT_VERSION = "1.1.0";

function createT13PromptDefinition({ modelName }) {
  return {
    promptId: T13_PROMPT_ID,
    version: T13_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.1",
    outputSchemaVersion: "1.0",
    changeSummary: "FULL CONTEXT: company_context fields + leadership identity on report narrative",
    approvedBy: null,
    rollbackVersion: "1.0.0",
  };
}

module.exports = { T13_PROMPT_ID, T13_PROMPT_VERSION, createT13PromptDefinition };
