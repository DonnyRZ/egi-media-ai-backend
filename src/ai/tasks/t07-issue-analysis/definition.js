const T07_PROMPT_ID = "T07_issue_analysis";
const T07_PROMPT_VERSION = "1.3.0";
const T07_REVIEW_PROMPT_ID = "T07_management_perspective_review";
const T07_REVIEW_PROMPT_VERSION = "1.0.0";

function createT07PromptDefinition({ modelName }) {
  return {
    promptId: T07_PROMPT_ID, version: T07_PROMPT_VERSION, status: "active", owner: "ai-engineering",
    modelCompatibility: [modelName], inputSchemaVersion: "1.2", outputSchemaVersion: "3.0",
    changeSummary: "Frame every issue as decision intelligence for the dashboard company's management",
    approvedBy: null, rollbackVersion: "1.2.0",
  };
}

function createT07ReviewPromptDefinition({ modelName }) {
  return {
    promptId: T07_REVIEW_PROMPT_ID,
    version: T07_REVIEW_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.0",
    outputSchemaVersion: "1.0",
    changeSummary: "Review and correct management-perspective framing before analysis persistence",
    approvedBy: null,
    rollbackVersion: null,
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
