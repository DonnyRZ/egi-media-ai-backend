const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const { createT09PromptDefinition } = require("./definition");
const { IssuePriorityEnumService } = require("./service");
const { InMemoryIssuePriorityStore } = require("./priority.store");

function createT09PriorityEnumRuntime({ aiTaskKernel, openaiConfig, issueStore, analysisStore, getEffectiveContext, authorizeCompany, promptRegistry, runStore, priorityStore }) {
  const registry = promptRegistry || new PromptRegistry([createT09PromptDefinition({ modelName: openaiConfig.nanoModel })]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const priorities = priorityStore || new InMemoryIssuePriorityStore();
  const promptExecutionService = new PromptExecutionService({ promptRegistry: registry, aiTaskKernel, runStore: provenanceStore, openaiConfig });
  return {
    service: new IssuePriorityEnumService({ issueStore, analysisStore, getEffectiveContext, priorityStore: priorities, promptExecutionService, authorizeCompany }),
    promptRegistry: registry, runStore: provenanceStore, priorityStore: priorities,
  };
}

module.exports = { createT09PriorityEnumRuntime };
