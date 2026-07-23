const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryIssueStore } = require("../src/issues");
const { InMemoryIssueAnalysisStore } = require("../src/ai/tasks/t07-issue-analysis");
const { InMemoryIssuePriorityStore, T09_PROMPT_VERSION } = require("../src/ai/tasks/t09-priority-enum");
const { InMemoryPriorityReasonStore, T10_PROMPT_VERSION } = require("../src/ai/tasks/t10-priority-reason");
const { AlertEligibilityService, InMemoryAlertPreferenceStore, InMemoryAlertEventStore } = require("../src/alerts");

const tenantId = "tenant-h";
const companyId = "company-a";
const recipientId = "user-1";
const now = Date.parse("2026-07-22T12:00:00.000Z");

function buildRuntime({ priority = "tinggi", developmentType = "created", isMaterial = null, preference = {}, nowValue = now, withReason = true } = {}) {
  const issueId = "issue-1";
  const developmentId = "development-1";
  const issueStore = new InMemoryIssueStore({ uuid: () => "generated-id", now: () => nowValue });
  const analysisStore = new InMemoryIssueAnalysisStore({ uuid: () => "analysis-1", now: () => nowValue });
  const priorityStore = new InMemoryIssuePriorityStore({ uuid: () => "priority-1", now: () => nowValue });
  const reasonStore = new InMemoryPriorityReasonStore({ uuid: () => "reason-1", now: () => nowValue });
  const analysis = analysisStore.create({
    tenantId, companyId, issueId, contextVersion: 3, inputFingerprint: "analysis-fp", promptVersion: "1.0.0",
    analysis: { what_happened: "x", why_matters: "x", impacts: [], risks: [], watch: [], claims: [{ claim_id: "c1", text: "x", source_article_ids: ["source-1"] }] }, evidence: [], provenance: {},
  });
  analysisStore.promoteCurrent({ tenantId, companyId, analysisId: analysis.analysisId, gate: { gateStatus: "passed" } });
  const priorityDecision = priorityStore.create({ tenantId, companyId, issueId, analysisId: analysis.analysisId, contextVersion: 3, promptVersion: T09_PROMPT_VERSION, priority, provenance: {} });
  if (withReason) reasonStore.create({ tenantId, companyId, issueId, analysisId: analysis.analysisId, priorityDecisionId: priorityDecision.priorityDecisionId, promptVersion: T10_PROMPT_VERSION, reason: "Grounded reason.", sourceClaimIds: ["c1"], provenance: {} });
  issueStore.seed({
    issueId, tenantId, companyId, title: "Issue title", oneLiner: "Issue one-liner", status: "berkembang", currentPriority: priority,
    currentPriorityAnalysisId: analysis.analysisId, currentPriorityDecisionId: priorityDecision.priorityDecisionId,
    firstSeenAt: "2026-07-22T10:00:00.000Z", lastDevelopedAt: "2026-07-22T11:00:00.000Z", version: 3, closedAt: null,
    createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T11:00:00.000Z",
  });
  issueStore.developmentsById.set(developmentId, { developmentId, tenantId, companyId, issueId, developmentType, isMaterial, observedAt: "2026-07-22T11:00:00.000Z" });
  const preferenceStore = new InMemoryAlertPreferenceStore();
  preferenceStore.upsert({
    tenantId, companyId, recipientId, directHighEnabled: true, dailyDigestEnabled: true, timezone: "Asia/Jakarta", quietHours: null,
    ...preference,
  });
  const eventStore = new InMemoryAlertEventStore({ uuid: (() => { let i = 0; return () => `event-${++i}`; })(), now: () => nowValue });
  const service = new AlertEligibilityService({
    issueStore, analysisStore, priorityStore, reasonStore, preferenceStore, eventStore, now: () => nowValue,
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "alert.eligibility.evaluate",
  });
  return { service, issueStore, eventStore, issueId, developmentId };
}

test("high priority issue baru is eligible for direct alert by backend rules only", async () => {
  const { service, eventStore, issueId, developmentId } = buildRuntime();
  const result = await service.evaluate({ tenantId, companyId, issueId, developmentId, recipientId });
  assert.equal(result.decision.channel, "langsung");
  assert.equal(result.decision.status, "eligible");
  assert.equal(result.decision.reasonCode, "high_new_issue");
  assert.equal(eventStore.list().length, 1);
  assert.equal(Object.hasOwn(service, "aiTaskKernel"), false);
  assert.equal(Object.hasOwn(service, "sendEmail"), false);
});

test("high priority update fails closed until material-update policy has a resolved decision", async (t) => {
  await t.test("unresolved remains suppressed", async () => {
    const { service, issueId, developmentId } = buildRuntime({ developmentType: "updated", isMaterial: null });
    const result = await service.evaluate({ tenantId, companyId, issueId, developmentId, recipientId });
    assert.equal(result.decision.channel, "none");
    assert.equal(result.decision.reasonCode, "material_update_unresolved");
  });
  await t.test("explicit material update becomes direct eligible", async () => {
    const { service, issueId, developmentId } = buildRuntime({ developmentType: "updated", isMaterial: true });
    const result = await service.evaluate({ tenantId, companyId, issueId, developmentId, recipientId });
    assert.equal(result.decision.channel, "langsung");
    assert.equal(result.decision.reasonCode, "high_material_update");
  });
  await t.test("non-material update is not re-alerted", async () => {
    const { service, issueId, developmentId } = buildRuntime({ developmentType: "updated", isMaterial: false });
    const result = await service.evaluate({ tenantId, companyId, issueId, developmentId, recipientId });
    assert.equal(result.decision.channel, "none");
    assert.equal(result.decision.reasonCode, "update_not_material");
  });
});

test("medium uses digest preference, while low remains dashboard-only", async () => {
  const medium = buildRuntime({ priority: "sedang", developmentType: "updated", isMaterial: null });
  const mediumResult = await medium.service.evaluate({ tenantId, companyId, issueId: medium.issueId, developmentId: medium.developmentId, recipientId });
  assert.equal(mediumResult.decision.channel, "ringkasan");
  assert.equal(mediumResult.decision.status, "eligible");
  const low = buildRuntime({ priority: "rendah" });
  const lowResult = await low.service.evaluate({ tenantId, companyId, issueId: low.issueId, developmentId: low.developmentId, recipientId });
  assert.equal(lowResult.decision.channel, "none");
  assert.equal(lowResult.decision.reasonCode, "priority_not_alertable");
});

test("preference, quiet hours, direct content gate, and dedupe suppress without sending", async (t) => {
  await t.test("direct preference off", async () => {
    const { service, issueId, developmentId } = buildRuntime({ preference: { directHighEnabled: false } });
    const result = await service.evaluate({ tenantId, companyId, issueId, developmentId, recipientId });
    assert.equal(result.decision.reasonCode, "direct_preference_disabled");
  });
  await t.test("quiet hours", async () => {
    const jakartaQuietHour = Date.parse("2026-07-22T16:30:00.000Z");
    const { service, issueId, developmentId } = buildRuntime({ nowValue: jakartaQuietHour, preference: { quietHours: { start: "22:00", end: "07:00" } } });
    const result = await service.evaluate({ tenantId, companyId, issueId, developmentId, recipientId });
    assert.equal(result.decision.reasonCode, "quiet_hours");
  });
  await t.test("quiet hours also suppress a digest candidate", async () => {
    const jakartaQuietHour = Date.parse("2026-07-22T16:30:00.000Z");
    const { service, issueId, developmentId } = buildRuntime({ priority: "sedang", nowValue: jakartaQuietHour, preference: { quietHours: { start: "22:00", end: "07:00" } } });
    const result = await service.evaluate({ tenantId, companyId, issueId, developmentId, recipientId });
    assert.equal(result.decision.channel, "none");
    assert.equal(result.decision.reasonCode, "quiet_hours");
  });
  await t.test("missing T10 reason blocks direct", async () => {
    const { service, issueId, developmentId } = buildRuntime({ withReason: false });
    const result = await service.evaluate({ tenantId, companyId, issueId, developmentId, recipientId });
    assert.equal(result.decision.reasonCode, "direct_content_incomplete");
  });
  await t.test("second eligible evaluation is deduplicated", async () => {
    const { service, issueId, developmentId, eventStore } = buildRuntime();
    const first = await service.evaluate({ tenantId, companyId, issueId, developmentId, recipientId });
    const second = await service.evaluate({ tenantId, companyId, issueId, developmentId, recipientId });
    assert.equal(first.decision.channel, "langsung");
    assert.equal(second.decision.channel, "none");
    assert.equal(second.decision.reasonCode, "duplicate");
    assert.equal(eventStore.list().length, 2);
  });
});
