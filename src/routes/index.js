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

module.exports = (server, { companyContextService, getCompanyContextDraftService, cmsSourceGate, getT02Service, getT03Service, getT04Service, getIssueMutationService, getT05Service, getT06Service, getT07Service, getT08Service, getCitationGate, getT09Service, getT10Service, getExecutiveSummaryService, getIssueReadService, getAlertRuntime, getT12Service, getEmailDeliveryService, getReportRuntime, getIngestRuntime }) => {
  server.use(createCompanyContextRouter({
    companyContextService,
    getCompanyContextDraftService,
  }));
  server.use(createSourceRouter({ cmsSourceGate }));
  server.use(createRelevanceRouter({ getT02Service, getT03Service }));
  server.use(createIssueFormationRouter({ getT04Service, getIssueMutationService, getT05Service, getT06Service }));
  server.use(createAnalysisRouter({ getT07Service, getT08Service, getCitationGate }));
  server.use(createPriorityRouter({ getT09Service, getT10Service }));
  server.use(createDashboardRouter({ getExecutiveSummaryService, getIssueReadService }));
  server.use(createAlertRouter({ getAlertRuntime, getT12Service, getEmailDeliveryService }));
  server.use(createReportRouter({ getReportRuntime }));
  server.use(createIngestRouter({ getIngestRuntime }));
};
