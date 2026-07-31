const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const { createT13PromptDefinition } = require("./definition");
const { ReportNarrativeService } = require("./service");
const { InMemoryReportNarrativeStore } = require("../../../reports/report-narrative.store");

function createT13ReportNarrativeRuntime({ aiTaskKernel, openaiConfig, reportDraftStore, authorizeCompany, promptRegistry, runStore, narrativeStore, companyStore = null, resolveOutputLanguage = null, getCompanyContextVersion = null }) {
  const registry = promptRegistry || new PromptRegistry([createT13PromptDefinition({ modelName: openaiConfig.miniModel })]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const narratives = narrativeStore || new InMemoryReportNarrativeStore();
  const promptExecutionService = new PromptExecutionService({ promptRegistry: registry, aiTaskKernel, runStore: provenanceStore, openaiConfig });
  return {
    service: new ReportNarrativeService({
      reportDraftStore, narrativeStore: narratives, promptExecutionService, companyStore, resolveOutputLanguage, getCompanyContextVersion, authorizeCompany,
    }),
    promptRegistry: registry, runStore: provenanceStore, narrativeStore: narratives,
  };
}

module.exports = { createT13ReportNarrativeRuntime };
