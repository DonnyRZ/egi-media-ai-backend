const { InMemoryIssueStore } = require("./issue.store");
const { IssueMutationService } = require("./issue-mutation.service");

function createIssueMutationRuntime({ matchDecisionStore, relevanceDecisionStore, issueStore, authorizeCompany } = {}) {
  const store = issueStore || new InMemoryIssueStore();
  return {
    issueStore: store,
    service: new IssueMutationService({ matchDecisionStore, relevanceDecisionStore, issueStore: store, authorizeCompany }),
  };
}

module.exports = { createIssueMutationRuntime };
