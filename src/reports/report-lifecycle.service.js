const { AiConfigurationError } = require("../ai/provider/provider.errors");
const { T13_PROMPT_VERSION } = require("../ai/tasks/t13-report-narrative/definition");

const TRANSITIONS = Object.freeze({
  submit_review: { from: new Set(["draft"]), to: "in_review", authorization: "report.review.submit" },
  approve: { from: new Set(["in_review"]), to: "approved", authorization: "report.approve" },
  share: { from: new Set(["approved"]), to: "shared", authorization: "report.share" },
});

class ReportLifecycleService {
  constructor({ reportDraftStore, narrativeStore, authorizeReportAction = denyByDefault, sharePublisher = denyShare }) {
    if (!reportDraftStore?.get || !reportDraftStore?.transition) throw new AiConfigurationError("Report lifecycle requires report draft persistence");
    if (!narrativeStore?.get) throw new AiConfigurationError("Report lifecycle requires validated report narrative lookup");
    Object.assign(this, { reportDraftStore, narrativeStore, authorizeReportAction, sharePublisher });
  }

  async submitForReview({ actor, tenantId, companyId, reportId, expectedVersion, note = null }) {
    return this._transition({ action: "submit_review", actor, tenantId, companyId, reportId, expectedVersion, note });
  }

  async approve({ actor, tenantId, companyId, reportId, expectedVersion, note = null }) {
    return this._transition({ action: "approve", actor, tenantId, companyId, reportId, expectedVersion, note });
  }

  async share({ actor, tenantId, companyId, reportId, expectedVersion, shareTarget, note = null }) {
    const report = await this._loadAndAuthorize({ action: "share", actor, tenantId, companyId, reportId });
    this._assertTransition({ report, action: "share", expectedVersion });
    const narrative = this.narrativeStore.get({ reportId, promptVersion: T13_PROMPT_VERSION });
    if (!narrative || narrative.reviewStatus !== "draft") throw new AiConfigurationError("Report share requires a validated draft narrative");
    await this.sharePublisher.share({ report, narrative, actor, shareTarget });
    return this._persistTransition({ report, action: "share", actor, tenantId, companyId, expectedVersion, note, shareTarget });
  }

  async _transition({ action, actor, tenantId, companyId, reportId, expectedVersion, note }) {
    const report = await this._loadAndAuthorize({ action, actor, tenantId, companyId, reportId });
    this._assertTransition({ report, action, expectedVersion });
    if (action === "submit_review" || action === "approve") {
      const narrative = this.narrativeStore.get({ reportId, promptVersion: T13_PROMPT_VERSION });
      if (!narrative || narrative.reviewStatus !== "draft") throw new AiConfigurationError(`Report ${action} requires a validated draft narrative`);
    }
    return this._persistTransition({ report, action, actor, tenantId, companyId, expectedVersion, note });
  }

  async _loadAndAuthorize({ action, actor, tenantId, companyId, reportId }) {
    if (!actor || actor.actorType !== "human" || typeof actor.actorId !== "string" || !actor.actorId) throw new AiConfigurationError("Report lifecycle requires an authenticated human actor");
    const rule = TRANSITIONS[action];
    const granted = await this.authorizeReportAction({ actor, tenantId, companyId, action: rule.authorization });
    if (granted !== true) throw new AiConfigurationError("Report lifecycle action was not authorized");
    const report = this.reportDraftStore.get({ tenantId, companyId, reportId });
    if (!report) throw new AiConfigurationError("Report was not found in the same tenant and company");
    return report;
  }

  _assertTransition({ report, action, expectedVersion }) {
    const rule = TRANSITIONS[action];
    if (!Number.isInteger(expectedVersion) || expectedVersion !== report.version) throw new AiConfigurationError("Report version conflict");
    if (!rule.from.has(report.reviewStatus)) throw new AiConfigurationError(`Report cannot ${action} from ${report.reviewStatus}`);
  }

  _persistTransition({ report, action, actor, tenantId, companyId, expectedVersion, note, shareTarget }) {
    const rule = TRANSITIONS[action];
    const result = this.reportDraftStore.transition({ tenantId, companyId, reportId: report.reportId, expectedVersion, nextStatus: rule.to, actor, action, note, shareTarget });
    if (!result?.report) throw new AiConfigurationError("Report version conflict");
    return result.report;
  }
}

function denyByDefault() { throw new AiConfigurationError("Report lifecycle requires an authorization guard"); }
function denyShare() { throw new AiConfigurationError("Report share requires a backend share publisher"); }
module.exports = { ReportLifecycleService, TRANSITIONS };
