const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const {
  createT07PromptDefinition,
  createT07ReviewPromptDefinition,
} = require("./definition");
const { IssueAnalysisService } = require("./service");
const { InMemoryIssueAnalysisStore } = require("./analysis.store");

function createT07IssueAnalysisRuntime({ aiTaskKernel, openaiConfig, cmsSourceGate, issueStore, getEffectiveContext, authorizeCompany, promptRegistry, runStore, analysisStore, companyStore = null, resolveOutputLanguage = null }) {
  const registry = promptRegistry || new PromptRegistry([
    createT07PromptDefinition({ modelName: openaiConfig.miniModel }),
    createT07ReviewPromptDefinition({ modelName: openaiConfig.miniModel }),
  ]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const analyses = analysisStore || new InMemoryIssueAnalysisStore();
  const promptExecutionService = new PromptExecutionService({ promptRegistry: registry, aiTaskKernel, runStore: provenanceStore, openaiConfig });
  return { service: new IssueAnalysisService({ cmsSourceGate, issueStore, getEffectiveContext, analysisStore: analyses, promptExecutionService, companyStore, resolveOutputLanguage, authorizeCompany }), promptRegistry: registry, runStore: provenanceStore, analysisStore: analyses };
}

module.exports = { createT07IssueAnalysisRuntime };
