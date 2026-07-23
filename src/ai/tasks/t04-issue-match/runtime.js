const { PromptRegistry } = require("../../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../provenance/prompt-run.store");
const { createT04PromptDefinition } = require("./definition");
const { IssueMatchService } = require("./service");
const { InMemoryIssueCandidateStore } = require("./issue-candidate.store");
const { InMemoryIssueMatchDecisionStore } = require("./match-decision.store");

function createT04IssueMatchRuntime({ aiTaskKernel, openaiConfig, cmsSourceGate, decisionStore, authorizeCompany, promptRegistry, runStore, issueCandidateStore, matchDecisionStore }) {
  const registry = promptRegistry || new PromptRegistry([createT04PromptDefinition({ modelName: openaiConfig.nanoModel })]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const candidates = issueCandidateStore || new InMemoryIssueCandidateStore();
  const decisions = matchDecisionStore || new InMemoryIssueMatchDecisionStore();
  const promptExecutionService = new PromptExecutionService({
    promptRegistry: registry, aiTaskKernel, runStore: provenanceStore, openaiConfig,
  });
  return {
    service: new IssueMatchService({
      cmsSourceGate, decisionStore, issueCandidateStore: candidates, matchDecisionStore: decisions,
      promptExecutionService, authorizeCompany,
    }),
    promptRegistry: registry,
    runStore: provenanceStore,
    issueCandidateStore: candidates,
    matchDecisionStore: decisions,
  };
}

module.exports = { createT04IssueMatchRuntime };
