const config = require("../config/global_config");
const { createOpenAiClient } = require("./provider/openai.client");
const { AiTaskKernel } = require("./kernel/ai-task-kernel");
const { PromptRegistry, PromptExecutionService, InMemoryPromptRunStore } = require("./prompt");
const t01CompanyContextDraft = require("./tasks/t01-company-context-draft");
const t02RelevanceClass = require("./tasks/t02-relevance-class");
const t03RelevanceRationale = require("./tasks/t03-relevance-rationale");
const t04IssueMatch = require("./tasks/t04-issue-match");
const t05IssueTitle = require("./tasks/t05-issue-title");
const t06IssueOneLiner = require("./tasks/t06-issue-oneliner");
const t07IssueAnalysis = require("./tasks/t07-issue-analysis");
const t08ClaimLabels = require("./tasks/t08-claim-labels");
const t09PriorityEnum = require("./tasks/t09-priority-enum");
const t10PriorityReason = require("./tasks/t10-priority-reason");
const t12DirectBlurbs = require("./tasks/t12-direct-blurbs");
const t13ReportNarrative = require("./tasks/t13-report-narrative");
const t14ConstrainedRewrite = require("./tasks/t14-constrained-rewrite");
const { createCmsSourceGate } = require("../cms");
const issueMutation = require("../issues");
const analysisGate = require("../analysis");
const dashboard = require("../dashboard");
const alerts = require("../alerts");
const delivery = require("../delivery");
const reports = require("../reports");
const { AiBudgetGate } = require("../automation/ai-budget");
const { createLogger } = require("../observability");
const sharedBudgetGate = new AiBudgetGate(config.get("/aiBudget"));
const aiLogger = createLogger({ service: `${process.env.SERVICE_NAME || "egi-media-ai-backend"}.ai` });

function createAiTaskKernel() {
  const openaiConfig = config.get("/openai");
  const openaiClient = createOpenAiClient(openaiConfig);

  return new AiTaskKernel({
    openaiClient,
    openaiConfig,
    defaultTimeoutMs: openaiConfig.timeoutMs,
    budgetGate: sharedBudgetGate,
    logger: aiLogger,
  });
}

function createT01CompanyContextDraftRuntime({ authorizeCompany, draftStore, promptRegistry, runStore } = {}) {
  const openaiConfig = config.get("/openai");
  return t01CompanyContextDraft.createT01CompanyContextDraftRuntime({
    aiTaskKernel: createAiTaskKernel(),
    openaiConfig,
    authorizeCompany,
    draftStore,
    promptRegistry,
    runStore,
  });
}

module.exports = {
  createAiTaskKernel,
  AiTaskKernel,
  PromptRegistry,
  PromptExecutionService,
  InMemoryPromptRunStore,
  t01CompanyContextDraft,
  t02RelevanceClass,
  t03RelevanceRationale,
  t04IssueMatch,
  t05IssueTitle,
  t06IssueOneLiner,
  t07IssueAnalysis,
  t08ClaimLabels,
  t09PriorityEnum,
  t10PriorityReason,
  t12DirectBlurbs,
  t13ReportNarrative,
  t14ConstrainedRewrite,
  createT01CompanyContextDraftRuntime,
  createCmsSourceGate,
  issueMutation,
  analysisGate,
  dashboard,
  alerts,
  delivery,
  reports,
};
