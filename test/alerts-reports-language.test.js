const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryIssueStore } = require("../src/issues");
const { InMemoryIssueAnalysisStore } = require("../src/ai/tasks/t07-issue-analysis");
const { InMemoryIssuePriorityStore, T09_PROMPT_VERSION } = require("../src/ai/tasks/t09-priority-enum");
const { InMemoryPriorityReasonStore, T10_PROMPT_VERSION } = require("../src/ai/tasks/t10-priority-reason");
const { InMemoryAlertEventStore } = require("../src/alerts");
const { createT12DirectBlurbsRuntime } = require("../src/ai/tasks/t12-direct-blurbs");
const { buildT12Input, SYSTEM_POLICY: T12_SYSTEM_POLICY } = require("../src/ai/tasks/t12-direct-blurbs/prompt");
const { InMemoryReportDraftStore, InMemoryReportNarrativeStore } = require("../src/reports");
const { createT13ReportNarrativeRuntime } = require("../src/ai/tasks/t13-report-narrative");
const { createT14ConstrainedRewriteRuntime } = require("../src/ai/tasks/t14-constrained-rewrite");
const { buildT14Input, SYSTEM_POLICY: T14_SYSTEM_POLICY } = require("../src/ai/tasks/t14-constrained-rewrite/prompt");
const { T13_PROMPT_VERSION } = require("../src/ai/tasks/t13-report-narrative");
const { readyManagementIdentity } = require("./support/management-context");

// No backfill: changing company language preference does not rewrite existing blurbs/narratives.

const tenantId = "tenant-lang";
const companyId = "company-lang";
const actor = Object.freeze({ actorType: "human", actorId: "analyst-lang" });

function companyStore(locale) {
  return {
    get: async ({ tenantId: tid, companyId: cid }) => (
      tid === tenantId && cid === companyId ? { tenantId, companyId, locale, status: "active" } : null
    ),
  };
}

function trustedContextFrom(request) {
  const user = request.input.find((message) => message.role === "user")?.content || "";
  const match = user.match(/<TRUSTED_CONTEXT>([\s\S]*?)<\/TRUSTED_CONTEXT>/);
  assert.ok(match, "expected TRUSTED_CONTEXT in provider input");
  return match[1];
}

function assertOutputLanguage(request, expected) {
  const trusted = trustedContextFrom(request);
  assert.match(trusted, new RegExp(`"output_language":"${expected}"`));
}

function kernelOk(data, onKernelRequest) {
  return {
    execute: async (request) => {
      onKernelRequest?.(request);
      return {
        data,
        model: { alias: request.model || "nano", name: `${request.model || "nano"}-test-model` },
        correlation: { requestId: request.requestId, providerRequestId: "req_lang" },
        providerResponseId: "resp_lang",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        latencyMs: 8,
      };
    },
  };
}

function buildT12Fixture({ locale, onKernelRequest }) {
  const issueId = "issue-lang";
  const developmentId = "development-lang";
  const issueStore = new InMemoryIssueStore({ uuid: () => "generated-id", now: () => 0 });
  const analysisStore = new InMemoryIssueAnalysisStore({ uuid: () => "analysis-lang", now: () => 0 });
  const priorityStore = new InMemoryIssuePriorityStore({ uuid: () => "priority-lang", now: () => 0 });
  const reasonStore = new InMemoryPriorityReasonStore({ uuid: () => "reason-lang", now: () => 0 });
  const analysis = analysisStore.create({
    tenantId, companyId, issueId, contextVersion: 3, inputFingerprint: "analysis-fp", promptVersion: "1.0.0",
    analysis: {
      what_happened: "Regulasi diumumkan.", why_matters: "Kepatuhan berubah.", impacts: [], risks: [], watch: [],
      claims: [{ claim_id: "c1", text: "Regulasi menyasar operator logistik.", source_article_ids: ["source-1"] }],
    }, evidence: [], provenance: {},
  });
  analysisStore.promoteCurrent({ tenantId, companyId, analysisId: analysis.analysisId, gate: { gateStatus: "passed" } });
  const priority = priorityStore.create({
    tenantId, companyId, issueId, analysisId: analysis.analysisId, contextVersion: 3,
    promptVersion: T09_PROMPT_VERSION, priority: "tinggi", provenance: {},
  });
  reasonStore.create({
    tenantId, companyId, issueId, analysisId: analysis.analysisId, priorityDecisionId: priority.priorityDecisionId,
    promptVersion: T10_PROMPT_VERSION, reason: "Priority reason.", sourceClaimIds: ["c1"], provenance: {},
  });
  issueStore.seed({
    issueId, tenantId, companyId, title: "Perubahan regulasi logistik", oneLiner: "Ketentuan baru diumumkan.",
    status: "berkembang", currentPriority: "tinggi", currentPriorityAnalysisId: analysis.analysisId,
    currentPriorityDecisionId: priority.priorityDecisionId, firstSeenAt: "2026-07-22T10:00:00.000Z",
    lastDevelopedAt: "2026-07-22T11:00:00.000Z", version: 3, closedAt: null,
    createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T11:00:00.000Z",
  });
  issueStore.developmentsById.set(developmentId, {
    developmentId, tenantId, companyId, issueId, issueArticleId: "issue-article-1",
    developmentType: "created", observedAt: "2026-07-22T11:00:00.000Z",
  });
  issueStore.issueArticlesByKey.set("article-key", {
    issueArticleId: "issue-article-1", tenantId, companyId, issueId,
    canonicalUrl: "https://portal.example/id/articles/source-1",
  });
  const eventStore = new InMemoryAlertEventStore({ uuid: () => "event-lang", now: () => 0 });
  const event = eventStore.create({
    tenantId, companyId, issueId, developmentId, recipientId: "user-1",
    channel: "langsung", status: "eligible", reasonCode: "high_new_issue", dedupeKey: "dedupe-lang",
  });
  const runtime = createT12DirectBlurbsRuntime({
    aiTaskKernel: kernelOk({
      new_development_blurb: "A grounded development blurb.",
      short_impact_blurb: "A grounded impact blurb.",
      source_claim_ids: ["c1"],
    }, onKernelRequest),
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    eventStore, issueStore, analysisStore, priorityStore, reasonStore,
    getEffectiveContext: async () => ({ companyId, version: 3, status: "effective", fields: { name: "PT Example", industry: "Logistics" }, managementIdentity: readyManagementIdentity("PT Example") }),
    companyStore: companyStore(locale),
    authorizeCompany: async () => true,
  });
  return { runtime, event };
}

function selectedItem(index) {
  return {
    reportItemId: `item-${index}`, issueId: `issue-${index}`, analysisId: `analysis-${index}`,
    priority: index <= 2 ? "tinggi" : "sedang",
    title: `Issue ${index}`, oneLiner: `One-liner ${index}`,
    analysis: { whatHappened: `What happened ${index}`, whyMatters: `Why matters ${index}` },
    claims: [{ claimId: `c${index}`, text: `Validated claim ${index}`, sourceArticleIds: [`article-${index}`] }],
    citations: [{ sourceArticleId: `article-${index}`, canonicalUrl: `https://portal.example/id/articles/article-${index}` }],
  };
}

function t13Output(items) {
  return {
    report_type: "mingguan",
    executive_summary: ["Executive summary from selected pack.", "Dampak perlu dipantau.", "Belum ada metrik tambahan."],
    overview: [],
    issue_sections: items.map((item, index) => ({ report_item_id: item.reportItemId, issue_id: item.issueId, group: index === 0 ? "developing" : "new", title: item.title, priority: item.priority, status: "berkembang", what_happened: [`Issue narrative ${index + 1}.`], why_important: ["Penting bagi perusahaan."], impact: ["Combined impact."], risk: [], watch: ["Watch regulator updates."], source_claim_ids: [`c${index + 1}`] })),
    category_developments: [],
    comparison: { label: "Dibandingkan periode sebelumnya", new_items: [], worsened: [], improved: [], priority_shifts: [], source_claim_ids: [] },
    trends: [],
    company_impacts: [{ category: "Strategi", points: ["Dampak perlu dipantau."], source_claim_ids: ["c1"] }],
    risk_opportunity: [{ kind: "risk", title: "Risiko pemantauan", text: "Perkembangan perlu dipantau.", source_claim_ids: ["c1"] }],
    watch_items: [{ text: "Watch regulator updates.", source_claim_ids: ["c2"] }],
    follow_up_options: [{ text: "Tinjau kembali pada siklus berikutnya.", source_claim_ids: ["c1"] }],
    source_references: items.map((item, index) => ({
      claim_id: `c${index + 1}`, source_article_id: `article-${index + 1}`,
    })),
  };
}

function buildT13Fixture({ locale, onKernelRequest }) {
  const items = Array.from({ length: 2 }, (_, index) => selectedItem(index + 1));
  const reportDraftStore = new InMemoryReportDraftStore({ uuid: () => "report-lang", now: () => 0 });
  const report = reportDraftStore.createDraft({
    tenantId, companyId, reportType: "mingguan",
    periodStart: "2026-07-15T00:00:00.000Z", periodEnd: "2026-07-22T00:00:00.000Z",
    timezone: "Asia/Jakarta", contextVersion: 3,
    metrics: {
      periodStart: "2026-07-15T00:00:00.000Z", periodEnd: "2026-07-22T00:00:00.000Z",
      values: { issue_count: items.length, high_priority_count: 1 },
    },
    selectedIssuePack: items,
  });
  const runtime = createT13ReportNarrativeRuntime({
    aiTaskKernel: kernelOk(t13Output(items), onKernelRequest),
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    reportDraftStore,
    getCompanyContextVersion: async () => ({ companyId, version: 3, status: "effective", fields: { name: "PT Example", industry: "Logistics" }, managementIdentity: readyManagementIdentity("PT Example") }),
    companyStore: companyStore(locale),
    authorizeCompany: async () => true,
  });
  return { runtime, report };
}

function buildT14Fixture({ locale, onKernelRequest }) {
  const reportDraftStore = new InMemoryReportDraftStore({ uuid: () => "report-lang", now: () => 0 });
  const narrativeStore = new InMemoryReportNarrativeStore({ uuid: () => "narrative-lang", now: () => 0 });
  const report = reportDraftStore.createDraft({
    tenantId, companyId, reportType: "mingguan",
    periodStart: "2026-07-15T00:00:00.000Z", periodEnd: "2026-07-22T00:00:00.000Z",
    timezone: "Asia/Jakarta", contextVersion: 3, metrics: {},
    selectedIssuePack: [{
      reportItemId: "item-1", issueId: "issue-1", analysisId: "analysis-1", priority: "tinggi",
      title: "Issue 1", oneLiner: "One liner",
      analysis: { whatHappened: "Event occurred", whyMatters: "Important" },
      claims: [{ claimId: "c1", text: "Validated claim", sourceArticleIds: ["article-1"] }],
      citations: [{ sourceArticleId: "article-1", canonicalUrl: "https://portal.example/id/articles/article-1" }],
    }],
  });
  const stored = narrativeStore.create({
    tenantId, companyId, reportId: report.reportId, promptVersion: T13_PROMPT_VERSION,
    provenance: { runId: "t13-run" },
    narrative: {
      executiveSummary: "Summary stays put.",
      issueNarratives: [{ reportItemId: "item-1", narrative: "Initial issue narrative.", sourceClaimIds: ["c1"] }],
      impactNarrative: { narrative: "Initial impact.", sourceClaimIds: ["c1"] },
      watchItems: [{ narrative: "Watch item.", sourceClaimIds: ["c1"] }],
      sourceReferences: [{ claimId: "c1", sourceArticleId: "article-1" }],
    },
  });
  const runtime = createT14ConstrainedRewriteRuntime({
    aiTaskKernel: kernelOk({ replacement_text: "Clarified issue narrative without new facts." }, onKernelRequest),
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    reportDraftStore, narrativeStore,
    companyStore: companyStore(locale),
    authorizeCompany: async () => true,
  });
  return {
    runtime, report, stored,
    rewriteArgs: {
      tenantId, companyId, reportId: report.reportId, reportNarrativeId: stored.reportNarrativeId,
      expectedVersion: 1, allowedSpanId: "issue_narrative:item-1",
      humanInstruction: "Make the sentence clearer.", actor,
    },
  };
}

for (const [label, locale, expected] of [
  ["company locale en", "en", "en"],
  ["company locale id", "id", "id"],
  ["null company locale defaults to id", null, "id"],
]) {
  test(`T12 output_language: ${label}`, async () => {
    let request;
    const { runtime, event } = buildT12Fixture({ locale, onKernelRequest: (value) => { request = value; } });
    await runtime.service.generate({ tenantId, companyId, alertEventId: event.alertEventId });
    assertOutputLanguage(request, expected);
  });

  test(`T13 output_language: ${label}`, async () => {
    let request;
    const { runtime, report } = buildT13Fixture({ locale, onKernelRequest: (value) => { request = value; } });
    await runtime.service.generate({ tenantId, companyId, reportId: report.reportId });
    assertOutputLanguage(request, expected);
  });

  test(`T14 output_language: ${label}`, async () => {
    let request;
    const { runtime, rewriteArgs } = buildT14Fixture({ locale, onKernelRequest: (value) => { request = value; } });
    await runtime.service.rewrite(rewriteArgs);
    assertOutputLanguage(request, expected);
  });
}

test("T12 taskContract/system still forbids URL and recipient invent", () => {
  const input = buildT12Input({
    tenantId, companyId,
    issue: { issueId: "issue-1", title: "Title", oneLiner: "One liner" },
    development: { developmentId: "dev-1", developmentType: "created", observedAt: "2026-07-22T11:00:00.000Z" },
    detailUrl: "https://portal.example/id/articles/source-1",
    priority: "tinggi",
    sourceClaims: [{ claimId: "c1", text: "Claim text" }],
    outputLanguage: "en",
    context: { version: 3, fields: { name: "PT Example", industry: "Logistics" }, managementIdentity: readyManagementIdentity("PT Example") },
  });
  assert.match(T12_SYSTEM_POLICY, /Do not create URLs, recipients/);
  assert.match(input[1].content, /"forbidden":\["URL","recipient"/);
  assert.match(input[1].content, /"output_language":"en"/);
});

test("T14 still forbids new fact / URL / citation invent", () => {
  const report = {
    reportId: "report-1",
    selectedIssuePack: [{
      claims: [{ claimId: "c1", text: "Validated claim", sourceArticleIds: ["article-1"] }],
    }],
  };
  const narrative = { reportNarrativeId: "narrative-1", version: 1 };
  const span = { spanId: "issue_narrative:item-1", text: "Current span", sourceClaimIds: ["c1"] };
  const input = buildT14Input({
    tenantId, companyId, report, narrative, span,
    humanInstruction: "Clarify wording.",
    sourceClaims: [{ claimId: "c1", text: "Validated claim" }],
    outputLanguage: "id",
  });
  assert.match(T14_SYSTEM_POLICY, /do not add facts[\s\S]*URLs/);
  assert.match(input[1].content, /"forbidden":\[[^\]]*"new fact"[^\]]*"citation"[^\]]*"URL"/);
  assert.match(input[1].content, /"output_language":"id"/);
});
