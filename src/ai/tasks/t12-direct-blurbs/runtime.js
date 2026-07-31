const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const { createT12PromptDefinition } = require("./definition");
const { DirectAlertBlurbService } = require("./service");
const { InMemoryDirectAlertBlurbStore } = require("./blurb.store");

function createT12DirectBlurbsRuntime({ aiTaskKernel, openaiConfig, eventStore, issueStore, analysisStore, priorityStore, reasonStore, authorizeCompany, promptRegistry, runStore, blurbStore, companyStore = null, resolveOutputLanguage = null, getEffectiveContext = null }) {
  const registry = promptRegistry || new PromptRegistry([createT12PromptDefinition({ modelName: openaiConfig.nanoModel })]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const blurbs = blurbStore || new InMemoryDirectAlertBlurbStore();
  const promptExecutionService = new PromptExecutionService({ promptRegistry: registry, aiTaskKernel, runStore: provenanceStore, openaiConfig });
  return {
    service: new DirectAlertBlurbService({
      eventStore, issueStore, analysisStore, priorityStore, reasonStore, blurbStore: blurbs, promptExecutionService,
      companyStore, resolveOutputLanguage, getEffectiveContext, authorizeCompany,
    }),
    promptRegistry: registry, runStore: provenanceStore, blurbStore: blurbs,
  };
}

module.exports = { createT12DirectBlurbsRuntime };
