const T12_PROMPT_ID = "T12_direct_blurbs";
const T12_PROMPT_VERSION = "1.1.0";

function createT12PromptDefinition({ modelName }) {
  return {
    promptId: T12_PROMPT_ID, version: T12_PROMPT_VERSION, status: "active", owner: "ai-engineering",
    modelCompatibility: [modelName], inputSchemaVersion: "1.1", outputSchemaVersion: "1.0",
    changeSummary: "Leadership identity stamp for direct-alert blurbs", approvedBy: null, rollbackVersion: "1.0.0",
  };
}

module.exports = { T12_PROMPT_ID, T12_PROMPT_VERSION, createT12PromptDefinition };
