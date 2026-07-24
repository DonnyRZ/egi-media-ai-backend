class AutomationDownstreamBoundary {
  constructor({ alertRuntime = null, reportRuntime = null, recipientId = null, logger = null } = {}) { this.alertRuntime = alertRuntime; this.reportRuntime = reportRuntime; this.recipientId = recipientId; this.logger = logger || { info() {}, error() {} }; this.events = []; }
  async evaluate({ tenantId, companyId, issueId, pipelineId }) {
    const event = { tenantId, companyId, issueId, pipelineId, alert: { status: "suppressed", reason: "RECIPIENT_NOT_CONFIGURED" }, report: { status: "candidate", auto_created: false, reason: "HUMAN_REVIEW_OR_PERIOD_SCHEDULE_REQUIRED" }, createdAt: new Date().toISOString() };
    if (this.recipientId && this.alertRuntime?.service) {
      const issueStore = this.alertRuntime.issueStore || this.alertRuntime.service.issueStore;
      const issue = await issueStore?.getIssue?.({ tenantId, companyId, issueId });
      const development = await issueStore?.getLatestDevelopment?.({ tenantId, companyId, issueId });
      if (issue && development) event.alert = await this.alertRuntime.service.evaluate({ tenantId, companyId, issueId, developmentId: development.developmentId, recipientId: this.recipientId });
    }
    this.events.push(event); this.logger.info?.("pipeline_downstream_evaluated", { tenantId, companyId, issueId, alertStatus: event.alert?.status, reportStatus: event.report?.status }); return event;
  }
  list() { return this.events.map((event) => structuredClone(event)); }
}
module.exports = { AutomationDownstreamBoundary };
