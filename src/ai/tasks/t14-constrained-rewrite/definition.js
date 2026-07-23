const T14_PROMPT_ID = "T14_constrained_rewrite";
const T14_PROMPT_VERSION = "1.0.0";
function createT14PromptDefinition({ modelName }) { return { promptId: T14_PROMPT_ID, version: T14_PROMPT_VERSION, status: "active", owner: "ai-engineering", modelCompatibility: [modelName], inputSchemaVersion: "1.0", outputSchemaVersion: "1.0", changeSummary: "Rewrite one human-authorized cited report span without changing its factual or citation boundary", approvedBy: null, rollbackVersion: null }; }
module.exports = { T14_PROMPT_ID, T14_PROMPT_VERSION, createT14PromptDefinition };
