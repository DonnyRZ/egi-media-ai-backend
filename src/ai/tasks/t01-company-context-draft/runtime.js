const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const { createT01PromptDefinition } = require("./definition");
const { CompanyContextDraftService } = require("./service");
const { InMemoryCompanyContextDraftStore } = require("./draft.store");

function createT01CompanyContextDraftRuntime({ aiTaskKernel, openaiConfig, promptRegistry, runStore, draftStore, authorizeCompany }) {
  const registry = promptRegistry || new PromptRegistry([
    createT01PromptDefinition({ modelName: openaiConfig.miniModel }),
  ]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const companyContextDraftStore = draftStore || new InMemoryCompanyContextDraftStore();
  const promptExecutionService = new PromptExecutionService({
    promptRegistry: registry,
    aiTaskKernel,
    runStore: provenanceStore,
    openaiConfig,
  });

  return {
    service: new CompanyContextDraftService({
      promptExecutionService,
      draftStore: companyContextDraftStore,
      authorizeCompany,
      timeoutMs: openaiConfig.t01TimeoutMs,
    }),
    promptRegistry: registry,
    runStore: provenanceStore,
    draftStore: companyContextDraftStore,
  };
}

module.exports = { createT01CompanyContextDraftRuntime };
