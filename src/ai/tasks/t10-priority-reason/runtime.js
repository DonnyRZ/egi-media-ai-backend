const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const { createT10PromptDefinition } = require("./definition");
const { PriorityReasonService } = require("./service");
const { InMemoryPriorityReasonStore } = require("./reason.store");

function createT10PriorityReasonRuntime({ aiTaskKernel, openaiConfig, issueStore, analysisStore, priorityStore, labelStore, getEffectiveContext, authorizeCompany, promptRegistry, runStore, reasonStore }) {
  const registry = promptRegistry || new PromptRegistry([createT10PromptDefinition({ modelName: openaiConfig.miniModel })]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const reasons = reasonStore || new InMemoryPriorityReasonStore();
  const promptExecutionService = new PromptExecutionService({ promptRegistry: registry, aiTaskKernel, runStore: provenanceStore, openaiConfig });
  return {
    service: new PriorityReasonService({ issueStore, analysisStore, priorityStore, labelStore, getEffectiveContext, reasonStore: reasons, promptExecutionService, authorizeCompany }),
    promptRegistry: registry, runStore: provenanceStore, reasonStore: reasons,
  };
}

module.exports = { createT10PriorityReasonRuntime };
