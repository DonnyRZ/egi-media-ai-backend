const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const { createT05PromptDefinition } = require("./definition");
const { IssueTitleService } = require("./service");

function createT05IssueTitleRuntime({ aiTaskKernel, openaiConfig, cmsSourceGate, issueStore, matchDecisionStore, relevanceDecisionStore, authorizeCompany, promptRegistry, runStore, companyStore = null, resolveOutputLanguage = null }) {
  const registry = promptRegistry || new PromptRegistry([createT05PromptDefinition({ modelName: openaiConfig.nanoModel })]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const promptExecutionService = new PromptExecutionService({
    promptRegistry: registry, aiTaskKernel, runStore: provenanceStore, openaiConfig,
  });
  return {
    service: new IssueTitleService({
      cmsSourceGate, issueStore, matchDecisionStore, relevanceDecisionStore, promptExecutionService, companyStore, resolveOutputLanguage, authorizeCompany,
    }),
    promptRegistry: registry,
    runStore: provenanceStore,
  };
}

module.exports = { createT05IssueTitleRuntime };
