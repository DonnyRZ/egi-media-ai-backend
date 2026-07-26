const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const { createT03PromptDefinition } = require("./definition");
const { RelevanceRationaleService } = require("./service");
const { InMemoryRelevanceRationaleStore } = require("./rationale.store");

function createT03RelevanceRationaleRuntime({ aiTaskKernel, openaiConfig, cmsSourceGate, getCompanyContextVersion, authorizeCompany, decisionStore, promptRegistry, runStore, rationaleStore, companyStore = null, resolveOutputLanguage = null }) {
  const registry = promptRegistry || new PromptRegistry([createT03PromptDefinition({ modelName: openaiConfig.nanoModel })]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const storedRationales = rationaleStore || new InMemoryRelevanceRationaleStore();
  const promptExecutionService = new PromptExecutionService({
    promptRegistry: registry, aiTaskKernel, runStore: provenanceStore, openaiConfig,
  });
  return {
    service: new RelevanceRationaleService({
      cmsSourceGate, getCompanyContextVersion, promptExecutionService, decisionStore,
      rationaleStore: storedRationales, companyStore, resolveOutputLanguage, authorizeCompany,
    }),
    promptRegistry: registry,
    runStore: provenanceStore,
    rationaleStore: storedRationales,
  };
}

module.exports = { createT03RelevanceRationaleRuntime };
