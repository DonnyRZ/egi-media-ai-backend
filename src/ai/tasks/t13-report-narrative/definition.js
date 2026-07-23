const T13_PROMPT_ID = "T13_report_narrative";
const T13_PROMPT_VERSION = "1.0.0";
function createT13PromptDefinition({ modelName }) { return { promptId: T13_PROMPT_ID, version: T13_PROMPT_VERSION, status: "active", owner: "ai-engineering", modelCompatibility: [modelName], inputSchemaVersion: "1.0", outputSchemaVersion: "1.0", changeSummary: "Write a draft report narrative from backend-selected issue packs and metrics", approvedBy: null, rollbackVersion: null }; }
module.exports = { T13_PROMPT_ID, T13_PROMPT_VERSION, createT13PromptDefinition };
