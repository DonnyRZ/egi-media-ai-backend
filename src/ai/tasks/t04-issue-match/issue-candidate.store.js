const { AiConfigurationError } = require("../../provider/provider.errors");

const ACTIVE_ISSUE_STATUSES = new Set(["baru", "berkembang", "dipantau"]);
const ALL_ISSUE_STATUSES = new Set([...ACTIVE_ISSUE_STATUSES, "selesai"]);

class InMemoryIssueCandidateStore {
  constructor() {
    this.issuesById = new Map();
  }

  seed(issue) {
    this._validateIssue(issue);
    this.issuesById.set(issue.issueId, structuredClone(issue));
  }

  listActive({ tenantId, companyId }) {
    return [...this.issuesById.values()]
      .filter((issue) => issue.tenantId === tenantId && issue.companyId === companyId && ACTIVE_ISSUE_STATUSES.has(issue.status))
      .map(cloneForRead);
  }

  _validateIssue(issue) {
    if (!issue || typeof issue !== "object" || typeof issue.issueId !== "string"
      || typeof issue.tenantId !== "string" || typeof issue.companyId !== "string"
      || !ALL_ISSUE_STATUSES.has(issue.status) || typeof issue.title !== "string"
      || typeof issue.oneLiner !== "string" || typeof issue.lastDevelopedAt !== "string") {
      throw new AiConfigurationError("T04 issue candidate store received an invalid issue record");
    }
  }
}

function cloneForRead(value) {
  return deepFreeze(structuredClone(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

module.exports = { InMemoryIssueCandidateStore, ACTIVE_ISSUE_STATUSES };
