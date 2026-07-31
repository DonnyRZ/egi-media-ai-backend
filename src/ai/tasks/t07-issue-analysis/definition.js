const T07_PROMPT_ID = "T07_issue_analysis";
const T07_PROMPT_VERSION = "1.4.0";
const T07_REVIEW_PROMPT_ID = "T07_management_perspective_review";
const T07_REVIEW_PROMPT_VERSION = "1.1.0";

function createT07PromptDefinition({ modelName }) {
  return {
    promptId: T07_PROMPT_ID, version: T07_PROMPT_VERSION, status: "active", owner: "ai-engineering",
    modelCompatibility: [modelName], inputSchemaVersion: "1.3", outputSchemaVersion: "3.0",
    changeSummary: "FULL CONTEXT: leadership identity persona + company_context fields",
    approvedBy: null, rollbackVersion: "1.3.0",
  };
}

function createT07ReviewPromptDefinition({ modelName }) {
  return {
    promptId: T07_REVIEW_PROMPT_ID,
    version: T07_REVIEW_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.1",
    outputSchemaVersion: "1.0",
    changeSummary: "Review with leadership identity stamp in TRUSTED_CONTEXT",
    approvedBy: null,
    rollbackVersion: "1.0.0",
  };
}

module.exports = {
  T07_PROMPT_ID,
  T07_PROMPT_VERSION,
  T07_REVIEW_PROMPT_ID,
  T07_REVIEW_PROMPT_VERSION,
  createT07PromptDefinition,
  createT07ReviewPromptDefinition,
};
