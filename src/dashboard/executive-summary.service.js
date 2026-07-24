const { AiConfigurationError } = require("../ai/provider/provider.errors");
const { T09_PROMPT_VERSION } = require("../ai/tasks/t09-priority-enum/definition");

const PERIODS = Object.freeze({
  "24jam": 24 * 60 * 60 * 1000,
  "7hari": 7 * 24 * 60 * 60 * 1000,
  "30hari": 30 * 24 * 60 * 60 * 1000,
});
const PRIORITY_RANK = Object.freeze({ tinggi: 0, sedang: 1, rendah: 2 });
const ACTIVE_STATUSES = new Set(["baru", "berkembang", "dipantau"]);

class ExecutiveSummaryService {
  constructor({ issueStore, analysisStore, priorityStore, authorizeCompany = denyByDefault, now = Date.now }) {
    if (!issueStore?.listActive || !issueStore?.getLatestDevelopment) throw new AiConfigurationError("Executive Summary requires scoped issue and development reads");
    if (!analysisStore?.getCurrent) throw new AiConfigurationError("Executive Summary requires current analysis lookup");
    if (!priorityStore?.get) throw new AiConfigurationError("Executive Summary requires current priority lookup");
    Object.assign(this, { issueStore, analysisStore, priorityStore, authorizeCompany, now });
  }

  async getExecutiveSummary({ tenantId, companyId, period }) {
    await this._authorizeCompany({ tenantId, companyId });
    const periodMs = PERIODS[period];
    if (!periodMs) throw new AiConfigurationError("Executive Summary period must be 24jam, 7hari, or 30hari");
    const end = this.now();
    const start = end - periodMs;
    const eligible = await Promise.all((await this.issueStore.listActive({ tenantId, companyId }))
      .map(async (issue) => (await this._isEligible({ issue, tenantId, companyId, start, end })) ? issue : null));
    const items = eligible.filter(Boolean)
      .sort(compareIssues)
      .slice(0, 5)
      .map(serializeIssue);
    return { period, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), items };
  }

  async _isEligible({ issue, tenantId, companyId, start, end }) {
    if (!issue || issue.tenantId !== tenantId || issue.companyId !== companyId || !ACTIVE_STATUSES.has(issue.status)
      || !Object.hasOwn(PRIORITY_RANK, issue.currentPriority) || typeof issue.issueId !== "string") return false;
    const latestDevelopment = await this.issueStore.getLatestDevelopment({ tenantId, companyId, issueId: issue.issueId });
    const developmentAt = Date.parse(latestDevelopment?.observedAt);
    if (!Number.isFinite(developmentAt) || developmentAt < start || developmentAt > end || issue.lastDevelopedAt !== latestDevelopment.observedAt) return false;
    const analysis = await this.analysisStore.getCurrent({ tenantId, companyId, issueId: issue.issueId });
    if (!analysis || analysis.analysisId !== issue.currentPriorityAnalysisId || analysis.status !== "current" || !analysis.gate) return false;
    const priority = await this.priorityStore.get({ tenantId, companyId, issueId: issue.issueId, analysisId: analysis.analysisId, promptVersion: T09_PROMPT_VERSION });
    return priority?.priorityDecisionId === issue.currentPriorityDecisionId && priority.priority === issue.currentPriority;
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "dashboard.executive_summary.read" });
    if (granted !== true) throw new AiConfigurationError("Executive Summary tenant/company authorization was not granted");
  }
}

function compareIssues(left, right) {
  return PRIORITY_RANK[left.currentPriority] - PRIORITY_RANK[right.currentPriority]
    || right.lastDevelopedAt.localeCompare(left.lastDevelopedAt)
    || left.issueId.localeCompare(right.issueId);
}

function serializeIssue(issue) {
  return {
    issueId: issue.issueId,
    title: issue.title,
    oneLiner: issue.oneLiner,
    status: issue.status,
    priority: issue.currentPriority,
    lastDevelopedAt: issue.lastDevelopedAt,
  };
}

function denyByDefault() { throw new AiConfigurationError("Executive Summary requires a tenant/company authorization guard"); }

module.exports = { ExecutiveSummaryService, PERIODS, PRIORITY_RANK, compareIssues };
