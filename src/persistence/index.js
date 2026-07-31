const { PostgresRecordStore } = require("./postgres-record-store");
const stores = require("./postgres-stores");
const { PostgresIssueStore } = require("./postgres-issue-store");
const stageStores = require("./postgres-stage-stores");
const contextStores = require("./postgres-context-stores");
const { PostgresJobStore } = require("./postgres-job-store");
const { PostgresEmailDeliveryStore } = require("./postgres-delivery-store");
const ingestStores = require("./postgres-ingest-stores");
const { PostgresMembershipStore } = require("../auth/membership.store");
const { PostgresAccessAuditStore } = require("../auth/audit.store");
const { PostgresTenantStore } = require("../auth/tenant.store");
const { PostgresPipelineStateStore } = require("./postgres-pipeline-state-store");
const uploadStores = require("../company-context/upload-request.store");
// Membership is part of the AI authorization read model; the source CMS database remains read-only.
function createPostgresPersistence({ db } = {}) {
  if (!db) throw new TypeError("PostgreSQL persistence requires the AI database adapter");
  const { PostgresManagementIdentityStore } = require("./postgres-identity-store");
  return {
    membershipStore: new PostgresMembershipStore({ db }),
    accessAuditStore: new PostgresAccessAuditStore({ db }),
    uploadRequestStore: new uploadStores.PostgresCompanyContextUploadRequestStore({ db }),
    snapshotStore: new ingestStores.PostgresSourceSnapshotStore({ db }),
    watermarkStore: new ingestStores.PostgresWatermarkStore({ db }),
    jobStore: new PostgresJobStore({ db }),
    pipelineStateStore: new PostgresPipelineStateStore({ db }),
    deliveryStore: new PostgresEmailDeliveryStore({ db }),
    contextDraftStore: new contextStores.PostgresCompanyContextDraftStore({ db }),
    effectiveContextStore: new contextStores.PostgresEffectiveCompanyContextStore({ db }),
    managementIdentityStore: new PostgresManagementIdentityStore({ db }),
    issueStore: new PostgresIssueStore({ db }),
    relevanceDecisionStore: new stores.PostgresRelevanceDecisionStore({ db }),
    matchDecisionStore: new stores.PostgresIssueMatchDecisionStore({ db }),
    analysisStore: new stores.PostgresIssueAnalysisStore({ db }),
    priorityStore: new stores.PostgresIssuePriorityStore({ db }),
    rationaleStore: new stageStores.PostgresRelevanceRationaleStore({ db }),
    labelStore: new stageStores.PostgresClaimLabelStore({ db }),
    reasonStore: new stageStores.PostgresPriorityReasonStore({ db }),
    blurbStore: new stageStores.PostgresDirectAlertBlurbStore({ db }),
    savedIssueStore: new stores.PostgresSavedIssueStore({ db }),
    alertEventStore: new stores.PostgresAlertEventStore({ db }),
    alertPreferenceStore: new stores.PostgresAlertPreferenceStore({ db }),
    reportDraftStore: new stores.PostgresReportDraftStore({ db }),
    reportNarrativeStore: new stores.PostgresReportNarrativeStore({ db }),
  };
}
module.exports = { PostgresRecordStore, PostgresIssueStore, PostgresJobStore, PostgresPipelineStateStore, PostgresEmailDeliveryStore, PostgresMembershipStore, PostgresAccessAuditStore, PostgresTenantStore, ...uploadStores, createPostgresPersistence, ...stores, ...stageStores, ...contextStores, ...ingestStores };
