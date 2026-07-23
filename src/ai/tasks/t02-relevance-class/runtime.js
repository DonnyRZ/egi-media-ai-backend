const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const { createT02PromptDefinition } = require("./definition");
const { RelevanceClassificationService } = require("./service");
const { InMemoryRelevanceDecisionStore } = require("./decision.store");

function createT02RelevanceRuntime({ aiTaskKernel, openaiConfig, cmsSourceGate, getEffectiveContext, authorizeCompany, promptRegistry, runStore, decisionStore }) {
  const registry = promptRegistry || new PromptRegistry([createT02PromptDefinition({ modelName: openaiConfig.nanoModel })]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const relevanceDecisionStore = decisionStore || new InMemoryRelevanceDecisionStore();
  const promptExecutionService = new PromptExecutionService({
    promptRegistry: registry,
    aiTaskKernel,
    runStore: provenanceStore,
    openaiConfig,
  });

  return {
    service: new RelevanceClassificationService({
      cmsSourceGate,
      getEffectiveContext,
      promptExecutionService,
      decisionStore: relevanceDecisionStore,
      authorizeCompany,
    }),
    promptRegistry: registry,
    runStore: provenanceStore,
    decisionStore: relevanceDecisionStore,
  };
}

module.exports = { createT02RelevanceRuntime };
