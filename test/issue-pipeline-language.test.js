const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { LANGUAGE_NA_TASKS } = require("../src/language/ai-output-language");
const { InMemoryRelevanceDecisionStore } = require("../src/ai/tasks/t02-relevance-class");
const { fingerprint } = require("../src/ai/tasks/t02-relevance-class/service");
const { createT03RelevanceRationaleRuntime } = require("../src/ai/tasks/t03-relevance-rationale");
const { InMemoryIssueMatchDecisionStore } = require("../src/ai/tasks/t04-issue-match");
const { createT05IssueTitleRuntime } = require("../src/ai/tasks/t05-issue-title");
const { createT06IssueOneLinerRuntime } = require("../src/ai/tasks/t06-issue-oneliner");
const { createT07IssueAnalysisRuntime, InMemoryIssueAnalysisStore } = require("../src/ai/tasks/t07-issue-analysis");
const { InMemoryClaimLabelStore } = require("../src/ai/tasks/t08-claim-labels");
const { InMemoryIssuePriorityStore, T09_PROMPT_VERSION } = require("../src/ai/tasks/t09-priority-enum");
const { createT10PriorityReasonRuntime } = require("../src/ai/tasks/t10-priority-reason");
const { InMemoryIssueStore } = require("../src/issues");
const { readyManagementIdentity } = require("./support/management-context");

// No backfill: changing company language preference does not rewrite existing issue prose fields.

const tenantId = "tenant-lang";
const companyId = "company-lang";
const articleId = "123e4567-e89b-12d3-a456-426614174000";

function companyStore(locale) {
  return {
    get: async ({ tenantId: tid, companyId: cid }) => (
      tid === tenantId && cid === companyId ? { tenantId, companyId, locale, status: "active" } : null
    ),
  };
}

function idArticleSource({ updatedAt = "2026-07-22T11:00:00.000Z" } = {}) {
  return {
    sourceArticleId: articleId,
    requestedLocale: "id",
    contentLocale: "id",
    canonicalUrl: `https://portal.example/id/articles/${articleId}`,
    article: {
      id: articleId,
      title: "Regulasi logistik baru",
      summary: "Regulasi memengaruhi operator armada.",
      content: "Isi artikel bahasa Indonesia yang tidak boleh jadi output_language.",
      status: "published",
      publishedAt: "2026-07-22T10:00:00.000Z",
      updatedAt,
    },
  };
}

function context() {
  return {
    companyId,
    version: 3,
    status: "effective",
    managementIdentity: readyManagementIdentity("PT Example"),
    fields: { name: "PT Example", industry: "Logistics" },
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

const kernelOk = (data, onKernelRequest) => ({
  execute: async (request) => {
    onKernelRequest?.(request);
    const responseData = request.outputSchema?.name === "management_perspective_review_v1"
      ? { verdict: "pass", violations: [], corrected_analysis: null }
      : data;
    return {
      data: responseData,
      model: { alias: "nano", name: "nano-test-model" },
      correlation: { requestId: request.requestId, providerRequestId: "req_lang" },
      providerResponseId: "resp_lang",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      latencyMs: 8,
    };
  },
});

test("LANGUAGE_NA_TASKS keep T02/T04/T08/T09 as N/A (enums/match)", () => {
  assert.deepEqual([...LANGUAGE_NA_TASKS], ["T02", "T04", "T08", "T09"]);
  const helper = fs.readFileSync(path.join(__dirname, "../src/language/ai-output-language.js"), "utf8");
  assert.match(helper, /LANGUAGE_NA_TASKS[\s\S]*T02[\s\S]*T04[\s\S]*T08[\s\S]*T09/);
  assert.match(helper, /enums\/match — no prose output language/);
});

for (const [label, locale, expected] of [
  ["company locale en overrides Indonesian article", "en", "en"],
  ["company locale id keeps Indonesian", "id", "id"],
  ["null company locale defaults to id", null, "id"],
]) {
  test(`T03 output_language: ${label}`, async () => {
    const source = idArticleSource();
    const decisionStore = new InMemoryRelevanceDecisionStore({ uuid: () => "decision-lang", now: () => 0 });
    const decision = decisionStore.create({
      articleId,
      companyId,
      contextVersion: 3,
      inputFingerprint: fingerprint({ source, contextVersion: 3 }),
      source,
      output: { relevance: "high", confidence: 0.9, subject_relation: "self", competitor_opt_in: false },
      provenance: { runId: "t02" },
    });
    let request;
    const runtime = createT03RelevanceRationaleRuntime({
      aiTaskKernel: kernelOk({ rationale: "Grounded rationale." }, (value) => { request = value; }),
      openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
      cmsSourceGate: { requirePublishedArticle: async () => source },
      getCompanyContextVersion: async () => context(),
      decisionStore,
      companyStore: companyStore(locale),
      authorizeCompany: async () => true,
    });
    await runtime.service.generate({ tenantId, companyId, decisionId: decision.decisionId });
    assertOutputLanguage(request, expected);
  });

  test(`T05 output_language: ${label}`, async () => {
    const source = idArticleSource();
    const relevanceDecisionStore = new InMemoryRelevanceDecisionStore({ uuid: () => "relevance-lang", now: () => 0 });
    const matchDecisionStore = new InMemoryIssueMatchDecisionStore({ uuid: () => "match-lang", now: () => 0 });
    const issueStore = new InMemoryIssueStore({ now: () => Date.parse("2026-07-22T12:00:00.000Z") });
    const relevanceDecision = relevanceDecisionStore.create({
      articleId, companyId, contextVersion: 3,
      inputFingerprint: fingerprint({ source, contextVersion: 3 }), source,
      output: { relevance: "high", confidence: 0.9, subject_relation: "self", competitor_opt_in: false }, provenance: { runId: "t02" },
    });
    const matchDecision = matchDecisionStore.create({
      tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId, promptVersion: "1.0.0",
      output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" }, provenance: { runId: "t04" },
    });
    const mutation = issueStore.apply({ tenantId, companyId, matchDecision, relevanceDecision }).mutation;
    let request;
    const runtime = createT05IssueTitleRuntime({
      aiTaskKernel: kernelOk({ title: "Logistics regulation update" }, (value) => { request = value; }),
      openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
      cmsSourceGate: { requirePublishedArticle: async () => source },
      issueStore, matchDecisionStore, relevanceDecisionStore,
      getEffectiveContext: async () => context(),
      companyStore: companyStore(locale),
      authorizeCompany: async () => true,
    });
    await runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId });
    assertOutputLanguage(request, expected);
  });

  test(`T06 output_language: ${label}`, async () => {
    const source = idArticleSource();
    const relevanceDecisionStore = new InMemoryRelevanceDecisionStore({ uuid: () => "relevance-lang", now: () => 0 });
    const matchDecisionStore = new InMemoryIssueMatchDecisionStore({ uuid: () => "match-lang", now: () => 0 });
    const issueStore = new InMemoryIssueStore({ now: () => Date.parse("2026-07-22T12:00:00.000Z") });
    const relevanceDecision = relevanceDecisionStore.create({
      articleId, companyId, contextVersion: 3,
      inputFingerprint: fingerprint({ source, contextVersion: 3 }), source,
      output: { relevance: "high", confidence: 0.9, subject_relation: "self", competitor_opt_in: false }, provenance: { runId: "t02" },
    });
    const matchDecision = matchDecisionStore.create({
      tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId, promptVersion: "1.0.0",
      output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" }, provenance: { runId: "t04" },
    });
    const mutation = issueStore.apply({ tenantId, companyId, matchDecision, relevanceDecision }).mutation;
    issueStore.issuesById.get(mutation.issueId).title = "Regulasi Baru untuk Operator Logistik";
    let request;
    const runtime = createT06IssueOneLinerRuntime({
      aiTaskKernel: kernelOk({ one_liner: "A short grounded one-liner." }, (value) => { request = value; }),
      openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
      cmsSourceGate: { requirePublishedArticle: async () => source },
      issueStore, matchDecisionStore, relevanceDecisionStore,
      getEffectiveContext: async () => context(),
      companyStore: companyStore(locale),
      authorizeCompany: async () => true,
    });
    await runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId });
    assertOutputLanguage(request, expected);
  });

  test(`T07 output_language: ${label}`, async () => {
    const source = idArticleSource();
    const relevanceDecisionStore = new InMemoryRelevanceDecisionStore();
    const matchDecisionStore = new InMemoryIssueMatchDecisionStore();
    const issueStore = new InMemoryIssueStore({ now: () => Date.parse("2026-07-22T12:00:00.000Z") });
    const relevanceDecision = relevanceDecisionStore.create({
      articleId, companyId, contextVersion: 3, inputFingerprint: "fp-lang",
      source, output: { relevance: "high", confidence: 0.9, subject_relation: "self", competitor_opt_in: false }, provenance: { runId: "t02" },
    });
    const matchDecision = matchDecisionStore.create({
      tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId, promptVersion: "1.0.0",
      output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" }, provenance: { runId: "t04" },
    });
    const created = issueStore.apply({ tenantId, companyId, matchDecision, relevanceDecision }).mutation;
    let request;
    const runtime = createT07IssueAnalysisRuntime({
      aiTaskKernel: kernelOk({
        what_happened: ["A regulation was announced."],
        why_matters: ["It may affect fleet compliance."],
        impacts: [{ text: "Operators must review compliance.", source_article_ids: [articleId] }],
        risks: [],
        watch: [],
        claims: [{ claim_id: "c1", text: "Regulation targets logistics operators.", source_article_ids: [articleId] }],
        subject_relation: "unrelated",
      }, (value) => { request = value; }),
      openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
      cmsSourceGate: { requirePublishedArticle: async () => source },
      issueStore,
      getEffectiveContext: async () => context(),
      companyStore: companyStore(locale),
      authorizeCompany: async () => true,
    });
    const result = await runtime.service.analyze({ tenantId, companyId, issueId: created.issueId });
    assertOutputLanguage(request, expected);
    assert.equal(result.analysis.analysis.claims[0].claim_id, "c1");
  });

  test(`T10 output_language: ${label}`, async () => {
    const issueId = "issue-lang";
    const issueStore = new InMemoryIssueStore({ uuid: () => "generated-id", now: () => Date.parse("2026-07-22T12:00:00.000Z") });
    issueStore.seed({
      issueId, tenantId, companyId, title: "Perubahan regulasi logistik", oneLiner: "Regulasi baru diumumkan.",
      status: "berkembang", currentPriority: "tinggi", currentPriorityAnalysisId: "analysis-lang",
      currentPriorityDecisionId: "priority-lang", firstSeenAt: "2026-07-21T12:00:00.000Z",
      lastDevelopedAt: "2026-07-22T11:00:00.000Z", version: 3, closedAt: null,
      createdAt: "2026-07-21T12:00:00.000Z", updatedAt: "2026-07-22T11:00:00.000Z",
    });
    const analysisStore = new InMemoryIssueAnalysisStore({ uuid: () => "analysis-lang", now: () => 0 });
    const analysis = analysisStore.create({
      tenantId, companyId, issueId, contextVersion: 3, inputFingerprint: "analysis-fingerprint", promptVersion: "1.0.0",
      analysis: {
        what_happened: "Regulator mengumumkan ketentuan baru.", why_matters: "Kepatuhan armada dapat berubah.",
        impacts: [], risks: [], watch: [],
        claims: [
          { claim_id: "c1", text: "Ketentuan menyasar operator logistik.", source_article_ids: [articleId] },
          { claim_id: "c2", text: "Operator mungkin perlu menyesuaikan proses.", source_article_ids: [articleId] },
        ],
      },
      evidence: [], provenance: { runId: "t07" },
    });
    analysisStore.promoteCurrent({ tenantId, companyId, analysisId: analysis.analysisId, gate: { gateStatus: "passed" } });
    const priorityStore = new InMemoryIssuePriorityStore({ uuid: () => "priority-lang", now: () => 0 });
    const priority = priorityStore.create({
      tenantId, companyId, issueId, analysisId: analysis.analysisId, contextVersion: 3,
      promptVersion: T09_PROMPT_VERSION, priority: "tinggi", provenance: { runId: "t09" },
    });
    const labelStore = new InMemoryClaimLabelStore({ uuid: () => "labels-lang", now: () => 0 });
    labelStore.create({
      tenantId, companyId, issueId, analysisId: analysis.analysisId, promptVersion: "1.0.0",
      labels: [{ claim_id: "c1", label: "fact" }, { claim_id: "c2", label: "analysis" }],
      provenance: { runId: "t08" },
    });
    let request;
    const runtime = createT10PriorityReasonRuntime({
      aiTaskKernel: kernelOk({ reason: "Grounded priority reason.", source_claim_ids: ["c1"] }, (value) => { request = value; }),
      openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
      issueStore, analysisStore, priorityStore, labelStore,
      getEffectiveContext: async () => context(),
      companyStore: companyStore(locale),
      authorizeCompany: async () => true,
    });
    const result = await runtime.service.generate({
      tenantId, companyId, issueId, analysisId: analysis.analysisId, priorityDecisionId: priority.priorityDecisionId,
    });
    assertOutputLanguage(request, expected);
    assert.deepEqual(result.reason.sourceClaimIds, ["c1"]);
    assert.match(request.input[1].content, /"claim_id":"c1"/);
  });
}
