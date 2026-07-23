const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const { createT08PromptDefinition } = require("./definition");
const { ClaimLabelService } = require("./service");
const { InMemoryClaimLabelStore } = require("./label.store");
function createT08ClaimLabelsRuntime({ aiTaskKernel, openaiConfig, analysisStore, authorizeCompany, promptRegistry, runStore, labelStore }) {
  const registry = promptRegistry || new PromptRegistry([createT08PromptDefinition({ modelName: openaiConfig.nanoModel })]);
  const provenanceStore = runStore || new InMemoryPromptRunStore(); const labels = labelStore || new InMemoryClaimLabelStore();
  const promptExecutionService = new PromptExecutionService({ promptRegistry: registry, aiTaskKernel, runStore: provenanceStore, openaiConfig });
  return { service: new ClaimLabelService({ analysisStore, labelStore: labels, promptExecutionService, authorizeCompany }), promptRegistry: registry, runStore: provenanceStore, labelStore: labels };
}
module.exports = { createT08ClaimLabelsRuntime };
