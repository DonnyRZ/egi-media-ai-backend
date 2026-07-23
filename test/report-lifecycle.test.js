const test = require("node:test");
const assert = require("node:assert/strict");
const { InMemoryReportDraftStore, InMemoryReportNarrativeStore, ReportLifecycleService } = require("../src/reports");
const { T13_PROMPT_VERSION } = require("../src/ai/tasks/t13-report-narrative");

const scope = Object.freeze({ tenantId: "tenant-h", companyId: "company-a" });
const analyst = Object.freeze({ actorType: "human", actorId: "analyst-1" });
const executive = Object.freeze({ actorType: "human", actorId: "executive-1" });

function setup({ authorize = () => true, share = async () => undefined } = {}) {
  const drafts = new InMemoryReportDraftStore({ uuid: () => "report-1", now: () => Date.UTC(2026, 6, 22) });
  const narratives = new InMemoryReportNarrativeStore({ uuid: () => "narrative-1", now: () => Date.UTC(2026, 6, 22) });
  const report = drafts.createDraft({ ...scope, reportType: "daily", periodStart: "2026-07-21", periodEnd: "2026-07-21", timezone: "Asia/Jakarta", contextVersion: "1", metrics: {}, selectedIssuePack: [] });
  narratives.create({ ...scope, reportId: report.reportId, promptVersion: T13_PROMPT_VERSION, narrative: { summary: "Draft report" }, provenance: {} });
  return { drafts, narratives, report, service: new ReportLifecycleService({ reportDraftStore: drafts, narrativeStore: narratives, authorizeReportAction: authorize, sharePublisher: { share } }) };
}

test("human review, approval, then share follows the gated lifecycle", async () => {
  const delivered = [];
  const { service } = setup({ authorize: ({ action, actor }) => action === "report.review.submit" ? actor.actorId === analyst.actorId : actor.actorId === executive.actorId, share: async (payload) => delivered.push(payload) });
  const inReview = await service.submitForReview({ ...scope, reportId: "report-1", actor: analyst, expectedVersion: 1, note: "Ready for review" });
  const approved = await service.approve({ ...scope, reportId: "report-1", actor: executive, expectedVersion: inReview.version });
  const shared = await service.share({ ...scope, reportId: "report-1", actor: executive, expectedVersion: approved.version, shareTarget: { distributionId: "board-daily" } });
  assert.equal(inReview.reviewStatus, "in_review");
  assert.equal(approved.reviewStatus, "approved");
  assert.equal(shared.reviewStatus, "shared");
  assert.equal(shared.version, 4);
  assert.equal(delivered.length, 1);
  assert.equal(shared.activity.length, 3);
  assert.equal(shared.activity[2].shareTarget, undefined);
  assert.match(shared.activity[2].shareTargetHash, /^[a-f0-9]{64}$/);
});

test("approval and share are blocked until their preceding human gates pass", async () => {
  let sends = 0;
  const { service } = setup({ share: async () => { sends += 1; } });
  await assert.rejects(() => service.approve({ ...scope, reportId: "report-1", actor: executive, expectedVersion: 1 }), /cannot approve/);
  await assert.rejects(() => service.share({ ...scope, reportId: "report-1", actor: executive, expectedVersion: 1, shareTarget: { distributionId: "board" } }), /cannot share/);
  assert.equal(sends, 0);
});

test("AI actors and unauthorized humans cannot transition reports", async () => {
  let authorizations = 0;
  const { service } = setup({ authorize: () => { authorizations += 1; return false; } });
  await assert.rejects(() => service.submitForReview({ ...scope, reportId: "report-1", actor: { actorType: "ai", actorId: "t13" }, expectedVersion: 1 }), /authenticated human/);
  await assert.rejects(() => service.submitForReview({ ...scope, reportId: "report-1", actor: analyst, expectedVersion: 1 }), /not authorized/);
  assert.equal(authorizations, 1);
});

test("stale versions and failed delivery leave the report unshared", async () => {
  const { service, drafts } = setup({ share: async () => { throw new Error("provider unavailable"); } });
  await assert.rejects(() => service.submitForReview({ ...scope, reportId: "report-1", actor: analyst, expectedVersion: 7 }), /version conflict/);
  const inReview = await service.submitForReview({ ...scope, reportId: "report-1", actor: analyst, expectedVersion: 1 });
  const approved = await service.approve({ ...scope, reportId: "report-1", actor: executive, expectedVersion: inReview.version });
  await assert.rejects(() => service.share({ ...scope, reportId: "report-1", actor: executive, expectedVersion: approved.version, shareTarget: { distributionId: "board" } }), /provider unavailable/);
  const afterFailure = drafts.get({ ...scope, reportId: "report-1" });
  assert.equal(afterFailure.reviewStatus, "approved");
  assert.equal(afterFailure.activity.length, 2);
});
