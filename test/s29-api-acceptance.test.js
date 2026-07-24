const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryIssueStore } = require("../src/issues");
const { InMemoryRelevanceDecisionStore } = require("../src/ai/tasks/t02-relevance-class/decision.store");
const { InMemoryIssueMatchDecisionStore } = require("../src/ai/tasks/t04-issue-match/match-decision.store");
const { InMemoryIssueAnalysisStore } = require("../src/ai/tasks/t07-issue-analysis/analysis.store");
const { InMemoryClaimLabelStore } = require("../src/ai/tasks/t08-claim-labels/label.store");
const { InMemoryIssuePriorityStore } = require("../src/ai/tasks/t09-priority-enum/priority.store");
const { InMemoryPriorityReasonStore } = require("../src/ai/tasks/t10-priority-reason/reason.store");
const { InMemoryAlertPreferenceStore, InMemoryAlertEventStore, AlertEligibilityService } = require("../src/alerts");
const { InMemoryDirectAlertBlurbStore, T12_PROMPT_VERSION } = require("../src/ai/tasks/t12-direct-blurbs");
const { InMemoryReportDraftStore, InMemoryReportNarrativeStore, ReportLifecycleService } = require("../src/reports");
const { T07_PROMPT_VERSION } = require("../src/ai/tasks/t07-issue-analysis");
const { T08_PROMPT_VERSION } = require("../src/ai/tasks/t08-claim-labels");
const { T09_PROMPT_VERSION } = require("../src/ai/tasks/t09-priority-enum");
const { T10_PROMPT_VERSION } = require("../src/ai/tasks/t10-priority-reason");
const { T13_PROMPT_VERSION } = require("../src/ai/tasks/t13-report-narrative");

const tenantId = "tenant-s29";
const companyId = "company-s29";
const recipientId = "recipient-s29";
const articleId = "article-s29";
const now = "2026-07-23T08:00:00.000Z";

test("S29 accepts the complete backend flow from published article to issue, alert, and reviewed report", async () => {
  const context = { companyId, version: 1, status: "effective", industry: "logistics", priorities: ["cost control"] };
  const source = { sourceArticleId: articleId, requestedLocale: "id", contentLocale: "id", canonicalUrl: "https://portal.example/id/articles/article-s29", article: { publishedAt: now, updatedAt: now, title: "Regulasi logistik baru", summary: "Regulator menerbitkan aturan baru untuk operator logistik.", content: "Operator perlu meninjau kepatuhan dan jadwal implementasi." } };
  const authorize = async ({ tenantId: actualTenant, companyId: actualCompany }) => actualTenant === tenantId && actualCompany === companyId;
  const cmsSourceGate = { requirePublishedArticle: async ({ articleId: actualArticle }) => { if (actualArticle !== articleId) throw new Error("article not found"); return structuredClone(source); } };

  // Article -> relevance (T02 persisted output, high means the pipeline continues).
  const relevanceStore = new InMemoryRelevanceDecisionStore({ uuid: () => "relevance-s29", now: () => 0 });
  const relevance = relevanceStore.create({ articleId, companyId, contextVersion: context.version, inputFingerprint: "fingerprint-s29", source, output: { relevance: "high", confidence: 0.98 }, provenance: { task: "T02" } });
  assert.equal(relevance.branch, "continue");

  // Relevance -> issue formation (T04 new), then bounded issue content (T05/T06).
  const matchStore = new InMemoryIssueMatchDecisionStore({ uuid: () => "match-s29", now: () => 0 });
  const match = matchStore.create({ tenantId, companyId, relevanceDecisionId: relevance.decisionId, promptVersion: "1.0.0", output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" }, provenance: { task: "T04" } });
  const issueStore = new InMemoryIssueStore({ uuid: (() => { let n = 0; return () => `issue-object-s29-${++n}`; })(), now: () => 0 });
  const mutation = issueStore.apply({ tenantId, companyId, matchDecision: match, relevanceDecision: relevance });
  const issueId = mutation.mutation.issueId;
  const developmentId = mutation.mutation.developmentId;
  assert.equal(mutation.mutation.outcome, "applied");
  const title = issueStore.applyGeneratedTitle({ tenantId, companyId, issueId, developmentId, promptVersion: "1.0.0", title: "Regulasi logistik baru", provenance: { task: "T05" } });
  const oneLiner = issueStore.applyGeneratedOneLiner({ tenantId, companyId, issueId, developmentId, promptVersion: "1.0.0", oneLiner: "Aturan baru dapat memengaruhi kepatuhan operator logistik.", provenance: { task: "T06" } });
  assert.equal(title.reused, false);
  assert.equal(oneLiner.reused, false);

  // Issue -> analysis -> claim labels -> current gate -> priority.
  const analysisStore = new InMemoryIssueAnalysisStore({ uuid: () => "analysis-s29", now: () => 0 });
  const analysis = analysisStore.create({ tenantId, companyId, issueId, contextVersion: context.version, inputFingerprint: "analysis-fingerprint-s29", promptVersion: T07_PROMPT_VERSION, analysis: { what_happened: "Regulator menerbitkan aturan baru.", why_matters: "Operator perlu menilai dampak kepatuhan.", impacts: [], risks: [], watch: [], claims: [{ claim_id: "claim-s29", text: "Regulator menerbitkan aturan baru.", source_article_ids: [articleId] }] }, evidence: [source], provenance: { task: "T07" } });
  const current = analysisStore.promoteCurrent({ tenantId, companyId, analysisId: analysis.analysisId, gate: { gateStatus: "passed", citationSetValid: true } });
  const labels = new InMemoryClaimLabelStore({ uuid: () => "labels-s29", now: () => 0 });
  labels.create({ tenantId, companyId, analysisId: current.analysisId, issueId, promptVersion: T08_PROMPT_VERSION, labels: [{ claim_id: "claim-s29", label: "fact" }], provenance: { task: "T08" } });
  const priorities = new InMemoryIssuePriorityStore({ uuid: () => "priority-s29", now: () => 0 });
  const priority = priorities.create({ tenantId, companyId, issueId, analysisId: current.analysisId, contextVersion: context.version, promptVersion: T09_PROMPT_VERSION, priority: "tinggi", provenance: { task: "T09" } });
  issueStore.applyCurrentPriority({ tenantId, companyId, issueId, analysisId: current.analysisId, priorityDecisionId: priority.priorityDecisionId, priority: priority.priority });
  const reasons = new InMemoryPriorityReasonStore({ uuid: () => "reason-s29", now: () => 0 });
  reasons.create({ tenantId, companyId, issueId, analysisId: current.analysisId, priorityDecisionId: priority.priorityDecisionId, promptVersion: T10_PROMPT_VERSION, reason: "Dampak kepatuhan dan urgensi implementasi tinggi.", sourceClaimIds: ["claim-s29"], provenance: { task: "T10" } });
  assert.equal(issueStore.getIssue({ tenantId, companyId, issueId }).currentPriority, "tinggi");

  // Priority -> eligibility -> direct blurb; the alert service remains backend rules-only.
  const preferences = new InMemoryAlertPreferenceStore();
  preferences.upsert({ tenantId, companyId, recipientId, directHighEnabled: true, dailyDigestEnabled: true, timezone: "Asia/Jakarta", quietHours: null });
  const events = new InMemoryAlertEventStore({ uuid: () => "alert-event-s29", now: () => 0 });
  const eligibility = new AlertEligibilityService({ issueStore, analysisStore, priorityStore: priorities, reasonStore: reasons, preferenceStore: preferences, eventStore: events, authorizeCompany: authorize, now: () => Date.parse(now) });
  const alert = await eligibility.evaluate({ tenantId, companyId, issueId, developmentId, recipientId });
  assert.equal(alert.decision.channel, "langsung");
  assert.equal(alert.decision.status, "eligible");
  const blurbs = new InMemoryDirectAlertBlurbStore({ uuid: () => "blurb-s29", now: () => 0 });
  const blurb = blurbs.create({ tenantId, companyId, issueId, developmentId, alertEventId: alert.decision.alertEventId, promptVersion: T12_PROMPT_VERSION, newDevelopmentBlurb: "Regulasi baru diumumkan.", shortImpactBlurb: "Kepatuhan operasional perlu ditinjau.", sourceClaimIds: ["claim-s29"], provenance: { task: "T12" } });
  assert.equal(blurb.sourceClaimIds[0], "claim-s29");

  // Validated issue insight -> report draft -> narrative -> human review lifecycle.
  const drafts = new InMemoryReportDraftStore({ uuid: () => "report-s29", now: () => 0 });
  const report = drafts.createDraft({ tenantId, companyId, reportType: "harian", periodStart: "2026-07-23T00:00:00.000Z", periodEnd: now, timezone: "Asia/Jakarta", contextVersion: context.version, metrics: { periodStart: "2026-07-23T00:00:00.000Z", periodEnd: now, issueCount: 1 }, selectedIssuePack: [{ reportItemId: "item-s29", issueId, analysisId: current.analysisId, priority: "tinggi", title: title.title.title, oneLiner: oneLiner.oneLiner.oneLiner, analysis: { whatHappened: "Regulator menerbitkan aturan baru.", whyMatters: "Operator perlu menilai dampak kepatuhan." }, claims: [{ claimId: "claim-s29", text: "Regulator menerbitkan aturan baru.", sourceArticleIds: [articleId] }], citations: [{ sourceArticleId: articleId, canonicalUrl: source.canonicalUrl }] }] });
  const narratives = new InMemoryReportNarrativeStore({ uuid: () => "narrative-s29", now: () => 0 });
  narratives.create({ tenantId, companyId, reportId: report.reportId, promptVersion: T13_PROMPT_VERSION, narrative: { executive_summary: "Regulasi baru perlu ditindaklanjuti.", issue_narratives: [{ report_item_id: "item-s29", narrative: "Regulasi diumumkan.", source_claim_ids: ["claim-s29"] }], impact_narrative: { narrative: "Dampak kepatuhan perlu ditinjau.", source_claim_ids: ["claim-s29"] }, watch_items: [{ narrative: "Pantau implementasi.", source_claim_ids: ["claim-s29"] }], source_references: [{ claim_id: "claim-s29", source_article_id: articleId }] }, provenance: { task: "T13" } });
  const actor = { actorType: "human", actorId: "analyst-s29" };
  const lifecycle = new ReportLifecycleService({ reportDraftStore: drafts, narrativeStore: narratives, authorizeReportAction: async ({ actor: actualActor, tenantId: actualTenant, companyId: actualCompany }) => actualActor.actorType === "human" && actualTenant === tenantId && actualCompany === companyId, sharePublisher: { share: async () => {} } });
  const reviewed = await lifecycle.submitForReview({ actor, tenantId, companyId, reportId: report.reportId, expectedVersion: 1 });
  const approved = await lifecycle.approve({ actor, tenantId, companyId, reportId: report.reportId, expectedVersion: reviewed.version });
  const shared = await lifecycle.share({ actor, tenantId, companyId, reportId: report.reportId, expectedVersion: approved.version, shareTarget: { recipientRefs: [recipientId] } });
  assert.equal(shared.reviewStatus, "shared");
  assert.equal(shared.activity.length, 3);
});
