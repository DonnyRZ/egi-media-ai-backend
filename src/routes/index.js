const { createCompanyContextRouter } = require("./company-context");
const { createSourceRouter } = require("./source");
const { createRelevanceRouter } = require("./relevance");
const { createIssueFormationRouter } = require("./issues");
const { createAnalysisRouter } = require("./analysis");
const { createPriorityRouter } = require("./priority");
const { createDashboardRouter } = require("./dashboard");
const { createAlertRouter } = require("./alerts");
const { createReportRouter } = require("./reports");
const { createIngestRouter } = require("./ingest");
const { createCompanyRouter } = require("./companies");
const { createFeedbackRouter } = require("./feedback");
const { createAuthRouter } = require("./auth");

module.exports = (server, { companyContextService, getCompanyContextDraftService, cmsSourceGate, getT02Service, getT03Service, getT04Service, getIssueMutationService, getT05Service, getT06Service, getT07Service, getT08Service, getCitationGate, getT09Service, getT10Service, getExecutiveSummaryService, getIssueReadService, getSavedIssueStore, getIssueStore, getAlertRuntime, getT12Service, getEmailDeliveryService, getReportRuntime, getIngestRuntime, getFeedbackStore }) => {
  server.use(createCompanyContextRouter({
    companyContextService,
    getCompanyContextDraftService,
  }));
  server.use(createAuthRouter());
  server.use(createCompanyRouter());
  server.use(createSourceRouter({ cmsSourceGate }));
  server.use(createRelevanceRouter({ getT02Service, getT03Service }));
  server.use(createIssueFormationRouter({ getT04Service, getIssueMutationService, getT05Service, getT06Service, getSavedIssueStore, getIssueReadService, getIssueStore }));
  server.use(createAnalysisRouter({ getT07Service, getT08Service, getCitationGate }));
  server.use(createPriorityRouter({ getT09Service, getT10Service }));
  server.use(createDashboardRouter({ getExecutiveSummaryService, getIssueReadService }));
  server.use(createAlertRouter({ getAlertRuntime, getT12Service, getEmailDeliveryService }));
  server.use(createReportRouter({ getReportRuntime }));
  server.use(createIngestRouter({ getIngestRuntime }));
  server.use(createFeedbackRouter({ getFeedbackStore }));
};
