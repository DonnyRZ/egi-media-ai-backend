const T12_PROMPT_ID = "T12_direct_blurbs";
const T12_PROMPT_VERSION = "1.0.0";

function createT12PromptDefinition({ modelName }) {
  return {
    promptId: T12_PROMPT_ID, version: T12_PROMPT_VERSION, status: "active", owner: "ai-engineering",
    modelCompatibility: [modelName], inputSchemaVersion: "1.0", outputSchemaVersion: "1.0",
    changeSummary: "Write two bounded direct-alert blurbs after backend eligibility", approvedBy: null, rollbackVersion: null,
  };
}

module.exports = { T12_PROMPT_ID, T12_PROMPT_VERSION, createT12PromptDefinition };
