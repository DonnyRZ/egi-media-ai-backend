const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const { createT14PromptDefinition } = require("./definition");
const { ConstrainedRewriteService } = require("./service");

function createT14ConstrainedRewriteRuntime({ aiTaskKernel, openaiConfig, reportDraftStore, narrativeStore, authorizeCompany, promptRegistry, runStore, companyStore = null, resolveOutputLanguage = null }) {
  const registry = promptRegistry || new PromptRegistry([createT14PromptDefinition({ modelName: openaiConfig.nanoModel })]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const promptExecutionService = new PromptExecutionService({ promptRegistry: registry, aiTaskKernel, runStore: provenanceStore, openaiConfig });
  return {
    service: new ConstrainedRewriteService({
      reportDraftStore, narrativeStore, promptExecutionService, companyStore, resolveOutputLanguage, authorizeCompany,
    }),
    promptRegistry: registry, runStore: provenanceStore,
  };
}

module.exports = { createT14ConstrainedRewriteRuntime };
