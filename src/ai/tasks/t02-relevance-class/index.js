const { createT02PromptDefinition, T02_PROMPT_ID, T02_PROMPT_VERSION } = require("./definition");
const { T02_OUTPUT_SCHEMA } = require("./schema");
const { RelevanceClassificationService } = require("./service");
const { InMemoryRelevanceDecisionStore } = require("./decision.store");
const { createT02RelevanceRuntime } = require("./runtime");
const {
  CONTINUING_RELEVANCE,
  ALL_RELEVANCE,
  SUBJECT_RELATIONS,
  isContinuingRelevance,
  shouldFormIssue,
  branchForDecision,
} = require("./relevance-policy");
const { applySubjectIdentityGate, hasCompanyIdentityHit } = require("./subject-identity-gate");

module.exports = {
  createT02PromptDefinition,
  T02_PROMPT_ID,
  T02_PROMPT_VERSION,
  T02_OUTPUT_SCHEMA,
  RelevanceClassificationService,
  InMemoryRelevanceDecisionStore,
  createT02RelevanceRuntime,
  CONTINUING_RELEVANCE,
  ALL_RELEVANCE,
  SUBJECT_RELATIONS,
  isContinuingRelevance,
  shouldFormIssue,
  branchForDecision,
  applySubjectIdentityGate,
  hasCompanyIdentityHit,
};
