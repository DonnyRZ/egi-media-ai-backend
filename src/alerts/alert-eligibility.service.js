const { AlertEligibilityError } = require("./alert-eligibility.errors");
const { T09_PROMPT_VERSION } = require("../ai/tasks/t09-priority-enum/definition");
const { T10_PROMPT_VERSION } = require("../ai/tasks/t10-priority-reason/definition");

const CHANNELS = Object.freeze({ DIRECT: "langsung", DIGEST: "ringkasan", NONE: "none" });
const ACTIVE_STATUSES = new Set(["baru", "berkembang", "dipantau"]);

class AlertEligibilityService {
  constructor({ issueStore, analysisStore, priorityStore, reasonStore, preferenceStore, eventStore, authorizeCompany = denyByDefault, now = Date.now }) {
    if (!issueStore?.getIssue || !issueStore?.getDevelopment || !issueStore?.getAlertContentReadiness) throw new AlertEligibilityError("Alert eligibility requires scoped issue and development reads", { code: "CONFIGURATION_INVALID" });
    if (!analysisStore?.getCurrent || !priorityStore?.get || !reasonStore?.get) throw new AlertEligibilityError("Alert eligibility requires validated priority handoff reads", { code: "CONFIGURATION_INVALID" });
    if (!preferenceStore?.get || !eventStore?.findEligibleByDedupeKey || !eventStore?.create) throw new AlertEligibilityError("Alert eligibility requires preference and event persistence", { code: "CONFIGURATION_INVALID" });
    Object.assign(this, { issueStore, analysisStore, priorityStore, reasonStore, preferenceStore, eventStore, authorizeCompany, now });
  }

  async evaluate({ tenantId, companyId, issueId, developmentId, recipientId }) {
    await this._authorizeCompany({ tenantId, companyId });
    const issue = await this.issueStore.getIssue({ tenantId, companyId, issueId });
    const development = await this.issueStore.getDevelopment({ tenantId, companyId, developmentId });
    if (!issue || !development || development.issueId !== issueId || !ACTIVE_STATUSES.has(issue.status)) {
      throw new AlertEligibilityError("Alert eligibility requires an active issue and its scoped development");
    }
    const preference = await this.preferenceStore.get({ tenantId, companyId, recipientId });
    if (!isValidPreference(preference)) throw new AlertEligibilityError("Alert eligibility requires a valid recipient preference in the same tenant and company");
    const base = await this._validateCurrentPriority({ issue, tenantId, companyId });
    const candidate = this._selectChannel({ issue, development, preference, priorityDecision: base.priorityDecision });
    const dedupeKey = createDedupeKey({ tenantId, companyId, issueId, developmentId, recipientId, channel: candidate.channel });
    if (candidate.channel !== CHANNELS.NONE && await this.eventStore.findEligibleByDedupeKey(dedupeKey)) {
      return this._persist({ tenantId, companyId, issueId, developmentId, recipientId, channel: CHANNELS.NONE, status: "suppressed", reasonCode: "duplicate", dedupeKey });
    }
    if (candidate.channel !== CHANNELS.NONE && isWithinQuietHours({ now: this.now(), timezone: preference.timezone, quietHours: preference.quietHours })) {
      return this._persist({ tenantId, companyId, issueId, developmentId, recipientId, channel: CHANNELS.NONE, status: "suppressed", reasonCode: "quiet_hours", dedupeKey });
    }
    if (candidate.channel === CHANNELS.DIRECT) {
      const readiness = await this.issueStore.getAlertContentReadiness({ tenantId, companyId, issueId });
      const reason = await this.reasonStore.get({ priorityDecisionId: base.priorityDecision.priorityDecisionId, promptVersion: T10_PROMPT_VERSION });
      if (!readiness?.contentReady || !reason) {
        return this._persist({ tenantId, companyId, issueId, developmentId, recipientId, channel: CHANNELS.NONE, status: "suppressed", reasonCode: "direct_content_incomplete", dedupeKey });
      }
    }
    return this._persist({ tenantId, companyId, issueId, developmentId, recipientId, channel: candidate.channel, status: candidate.status, reasonCode: candidate.reasonCode, dedupeKey });
  }

  async _validateCurrentPriority({ issue, tenantId, companyId }) {
    const analysis = await this.analysisStore.getCurrent({ tenantId, companyId, issueId: issue.issueId });
    if (!analysis || analysis.analysisId !== issue.currentPriorityAnalysisId || analysis.status !== "current" || !analysis.gate) {
      throw new AlertEligibilityError("Alert eligibility requires a current citation-gated analysis");
    }
    const priorityDecision = await this.priorityStore.get({ tenantId, companyId, issueId: issue.issueId, analysisId: analysis.analysisId, promptVersion: T09_PROMPT_VERSION });
    if (!priorityDecision || priorityDecision.priorityDecisionId !== issue.currentPriorityDecisionId || priorityDecision.priority !== issue.currentPriority) {
      throw new AlertEligibilityError("Alert eligibility requires the current validated T09 priority");
    }
    return { analysis, priorityDecision };
  }

  _selectChannel({ issue, development, preference, priorityDecision }) {
    if (priorityDecision.priority === "tinggi") {
      if (development.developmentType === "created") return preference.directHighEnabled ? eligible(CHANNELS.DIRECT, "high_new_issue") : suppressed("direct_preference_disabled");
      if (development.developmentType === "updated") {
        if (development.isMaterial === null || development.isMaterial === undefined) return suppressed("material_update_unresolved");
        if (development.isMaterial !== true) return suppressed("update_not_material");
        return preference.directHighEnabled ? eligible(CHANNELS.DIRECT, "high_material_update") : suppressed("direct_preference_disabled");
      }
      return suppressed("development_type_invalid");
    }
    if (priorityDecision.priority === "sedang") {
      return preference.dailyDigestEnabled ? eligible(CHANNELS.DIGEST, "medium_new_development") : suppressed("digest_preference_disabled");
    }
    return suppressed("priority_not_alertable");
  }

  async _persist(event) { return { decision: await this.eventStore.create(event) }; }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "alert.eligibility.evaluate" });
    if (granted !== true) throw new AlertEligibilityError("Alert eligibility tenant/company authorization was not granted", { code: "FORBIDDEN" });
  }
}

function eligible(channel, reasonCode) { return { channel, status: "eligible", reasonCode }; }
function suppressed(reasonCode) { return { channel: CHANNELS.NONE, status: "suppressed", reasonCode }; }
function createDedupeKey({ tenantId, companyId, issueId, developmentId, recipientId, channel }) { return `${tenantId}|${companyId}|${issueId}|${developmentId}|${recipientId}|${channel}`; }

function isValidPreference(preference) {
  if (!preference || typeof preference.recipientId !== "string" || typeof preference.directHighEnabled !== "boolean" || typeof preference.dailyDigestEnabled !== "boolean" || typeof preference.timezone !== "string") return false;
  try { Intl.DateTimeFormat("en-US", { timeZone: preference.timezone }); } catch { return false; }
  return isValidQuietHours(preference.quietHours);
}
function isValidQuietHours(quietHours) {
  if (quietHours === null) return true;
  return !!quietHours && typeof quietHours === "object" && isClock(quietHours.start) && isClock(quietHours.end) && quietHours.start !== quietHours.end;
}
function isClock(value) { return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function isWithinQuietHours({ now, timezone, quietHours }) {
  if (quietHours === null) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const time = `${parts.find((part) => part.type === "hour").value}:${parts.find((part) => part.type === "minute").value}`;
  if (quietHours.start < quietHours.end) return time >= quietHours.start && time < quietHours.end;
  return time >= quietHours.start || time < quietHours.end;
}
function denyByDefault() { throw new AlertEligibilityError("Alert eligibility requires a tenant/company authorization guard", { code: "FORBIDDEN" }); }

module.exports = { AlertEligibilityService, CHANNELS, createDedupeKey, isWithinQuietHours };
