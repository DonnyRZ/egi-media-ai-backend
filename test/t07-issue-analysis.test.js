const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryRelevanceDecisionStore } = require("../src/ai/tasks/t02-relevance-class");
const { InMemoryIssueMatchDecisionStore } = require("../src/ai/tasks/t04-issue-match");
const { InMemoryIssueStore } = require("../src/issues");
const Ajv = require("ajv");
const { createT07IssueAnalysisRuntime, T07_OUTPUT_SCHEMA } = require("../src/ai/tasks/t07-issue-analysis");
const { T13_OUTPUT_SCHEMA } = require("../src/ai/tasks/t13-report-narrative/schema");

const tenantId = "tenant-h";
const companyId = "company-a";
const articleOne = "123e4567-e89b-12d3-a456-426614174000";
const articleTwo = "123e4567-e89b-12d3-a456-426614174001";
const unknownArticle = "123e4567-e89b-12d3-a456-426614174099";

function source(articleId, { updatedAt = "2026-07-22T11:00:00.000Z", content = "Evidence body." } = {}) {
  return {
    sourceArticleId: articleId, requestedLocale: "id", contentLocale: "id", canonicalUrl: `https://portal.example/id/articles/${articleId}`,
    article: { id: articleId, title: `Article ${articleId.slice(-3)}`, summary: "A relevant source summary.", content, status: "published", publishedAt: "2026-07-22T10:00:00.000Z", updatedAt },
  };
}

function context() {
  return { companyId, version: 3, status: "effective", fields: { name: "PT Example Logistics", industry: "Logistics", competitors: [], products: ["Fleet tracking"], topics: [], priorities: [], goals: [], regions: [] } };
}

function buildRuntime({ output, reviewOutput, sourceOverrides = {}, onKernelRequest, propagateRelation = false, relevanceSubject = "self" } = {}) {
  const relevanceDecisionStore = new InMemoryRelevanceDecisionStore();
  const matchDecisionStore = new InMemoryIssueMatchDecisionStore();
  const issueStore = new InMemoryIssueStore({ now: () => Date.parse("2026-07-22T12:00:00.000Z") });
  const initialSources = new Map([
    [articleOne, source(articleOne, { content: "FIRST_LINKED_CONTENT" })],
    [articleTwo, source(articleTwo, { content: "SECOND_LINKED_CONTENT" })],
  ]);
  const sources = new Map(initialSources);
  for (const [articleId, sourceValue] of Object.entries(sourceOverrides)) sources.set(articleId, sourceValue);
  const makeRelevance = (articleId, version) => relevanceDecisionStore.create({
    tenantId, articleId, companyId, contextVersion: 3, inputFingerprint: `fingerprint-${articleId}-${version}`,
    source: initialSources.get(articleId),
    output: { relevance: "high", confidence: 0.9, subject_relation: relevanceSubject, competitor_opt_in: false },
    provenance: { runId: "t02" },
  });
  const firstRelevance = makeRelevance(articleOne, 1);
  const firstMatch = matchDecisionStore.create({ tenantId, companyId, relevanceDecisionId: firstRelevance.decisionId, promptVersion: "1.0.0", output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" }, provenance: { runId: "t04" } });
  const created = issueStore.apply({ tenantId, companyId, matchDecision: firstMatch, relevanceDecision: firstRelevance }).mutation;
  const secondRelevance = makeRelevance(articleTwo, 2);
  const secondMatch = matchDecisionStore.create({ tenantId, companyId, relevanceDecisionId: secondRelevance.decisionId, promptVersion: "1.0.0", output: { decision: "update", candidate_issue_id: created.issueId, reason_code: "same_event" }, provenance: { runId: "t04" } });
  issueStore.apply({ tenantId, companyId, matchDecision: secondMatch, relevanceDecision: secondRelevance });
  let kernelCalls = 0;
  const runtime = createT07IssueAnalysisRuntime({
    aiTaskKernel: { execute: async (request) => {
      kernelCalls += 1; onKernelRequest?.(request);
      const isReview = request.outputSchema?.name === "management_perspective_review_v1";
      return {
        data: isReview
          ? (reviewOutput || { verdict: "pass", violations: [], corrected_analysis: null })
          : (output || validOutput()),
        model: { alias: "mini", name: "mini-test-model" },
        correlation: { requestId: request.requestId, providerRequestId: "req_t07" },
        providerResponseId: "resp_t07",
        usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
        latencyMs: 21,
      };
    } },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    cmsSourceGate: { requirePublishedArticle: async ({ articleId }) => sources.get(articleId) },
    relevanceDecisionStore: propagateRelation ? relevanceDecisionStore : null,
    issueStore, getEffectiveContext: async () => context(),
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "issue.analyze",
  });
  return { runtime, issueStore, created, kernelCalls: () => kernelCalls };
}

function validOutput() {
  return {
    what_happened: ["Regulasi baru diumumkan untuk operator logistik."],
    why_matters: ["Perubahan ini dapat memengaruhi operasi armada perusahaan."],
    impacts: [{ text: "Operator perlu meninjau kepatuhan armada.", source_article_ids: [articleOne] }],
    risks: [{ text: "Biaya penyesuaian dapat meningkat.", source_article_ids: [articleTwo] }],
    watch: [{ text: "Pantau panduan pelaksanaan regulator.", source_article_ids: [articleOne] }],
    claims: [{ claim_id: "c1", text: "Regulasi menyasar operator logistik.", source_article_ids: [articleOne] }],
    subject_relation: "unrelated",
  };
}

test("T07 analyzes only linked evidence, persists cited claims, and does not create priority or alert state", async () => {
  let input;
  const { runtime, issueStore, created, kernelCalls } = buildRuntime({ onKernelRequest: (request) => { input = request.input; } });
  const result = await runtime.service.analyze({ tenantId, companyId, issueId: created.issueId });

  assert.equal(kernelCalls(), 2);
  assert.equal(result.reused, false);
  assert.equal(result.analysis.analysis.claims[0].claim_id, "c1");
  assert.deepEqual(result.analysis.analysis.claims[0].source_article_ids, [articleOne]);
  assert.equal(result.analysis.evidence.length, 2);
  assert.equal(issueStore.getIssue({ tenantId, companyId, issueId: created.issueId }).currentPriority, null);
  assert.equal(Object.hasOwn(result.analysis.analysis, "priority"), false);
  assert.equal(Object.hasOwn(result.analysis.analysis, "alert"), false);
  assert.match(input[1].content, /FIRST_LINKED_CONTENT/);
  assert.match(input[1].content, /SECOND_LINKED_CONTENT/);
  assert.doesNotMatch(input[1].content, new RegExp(unknownArticle));
});

test("T07 is idempotent for the same issue, context, and linked evidence fingerprint", async () => {
  const { runtime, created, kernelCalls } = buildRuntime();
  const first = await runtime.service.analyze({ tenantId, companyId, issueId: created.issueId });
  const second = await runtime.service.analyze({ tenantId, companyId, issueId: created.issueId });
  assert.equal(second.reused, true);
  assert.equal(second.analysis.analysisId, first.analysis.analysisId);
  assert.equal(kernelCalls(), 2);
});

test("T07 perspective reviewer replaces externally framed analysis before persistence", async () => {
  const corrected = validOutput();
  corrected.why_matters = ["Perubahan eksternal ini dapat memengaruhi biaya dan keputusan armada PT Example Logistics."];
  corrected.impacts = [{
    text: "Manajemen PT Example Logistics perlu menilai paparan biaya kepatuhan.",
    source_article_ids: [articleOne],
  }];
  const { runtime, created } = buildRuntime({
    reviewOutput: {
      verdict: "corrected",
      violations: ["Candidate framed the external operator's internal operations instead of the dashboard company."],
      corrected_analysis: corrected,
    },
  });
  const result = await runtime.service.analyze({ tenantId, companyId, issueId: created.issueId });
  assert.deepEqual(result.analysis.analysis, corrected);
  assert.equal(result.analysis.provenance.managementPerspectiveReview.verdict, "corrected");
});

test("T07 propagates T02 subject relation instead of reclassifying issue evidence", async () => {
  const output = validOutput();
  output.subject_relation = "market";
  let generationRequest;
  const { runtime, created } = buildRuntime({
    output,
    propagateRelation: true,
    relevanceSubject: "market",
    onKernelRequest: (request) => {
      if (request.outputSchema?.name === "issue_analysis_v3") generationRequest = request;
    },
  });
  const result = await runtime.service.analyze({ tenantId, companyId, issueId: created.issueId });
  assert.equal(result.analysis.analysis.subject_relation, "market");
  assert.match(generationRequest.input[1].content, /"subject_relation":"market"/);
});

test("T07 rejects an out-of-evidence citation without persisting an analysis", async () => {
  const output = validOutput();
  output.claims[0].source_article_ids = [unknownArticle];
  const { runtime, created } = buildRuntime({ output });
  await assert.rejects(runtime.service.analyze({ tenantId, companyId, issueId: created.issueId }), { code: "AI_OUTPUT_SCHEMA_INVALID" });
  assert.deepEqual(runtime.analysisStore.list(), []);
  assert.equal(runtime.runStore.list()[0].validationOutcome, "failed");
});

test("T07 does not call the model when linked evidence is stale or cross-scope", async (t) => {
  await t.test("stale linked source", async () => {
    const { runtime, created, kernelCalls } = buildRuntime({ sourceOverrides: { [articleOne]: source(articleOne, { updatedAt: "2026-07-23T11:00:00.000Z" }) } });
    await assert.rejects(runtime.service.analyze({ tenantId, companyId, issueId: created.issueId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });
  await t.test("cross-scope relation", async () => {
    const { runtime, issueStore, created, kernelCalls } = buildRuntime();
    const linked = issueStore.listArticles({ issueId: created.issueId })[0];
    for (const record of issueStore.issueArticlesByKey.values()) if (record.issueArticleId === linked.issueArticleId) record.companyId = "company-other";
    await assert.rejects(runtime.service.analyze({ tenantId, companyId, issueId: created.issueId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });
});

test("T07 accepts crawl evidence when linked sourceUpdatedAt is null or omitted", async (t) => {
  const crawlId = "crawl:detik:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const mediaUrl = "https://news.detik.com/berita/artikel-asli";

  for (const [name, linkedUpdatedAt] of [
    ["explicit null", null],
    ["omitted key (production crawl rows)", undefined],
  ]) {
    await t.test(name, async () => {
      const relevanceDecisionStore = new InMemoryRelevanceDecisionStore();
      const matchDecisionStore = new InMemoryIssueMatchDecisionStore();
      const issueStore = new InMemoryIssueStore({ now: () => Date.parse("2026-07-22T12:00:00.000Z") });
      const crawlSource = {
        sourceArticleId: crawlId, requestedLocale: "id", contentLocale: "id", canonicalUrl: mediaUrl,
        article: { id: crawlId, title: "Crawl article", summary: "Ringkasan.", content: "CRAWL_BODY", status: "published", publishedAt: "2026-07-22T10:00:00.000Z", updatedAt: null },
      };
      const relevance = relevanceDecisionStore.create({
        articleId: crawlId, companyId, contextVersion: 3, inputFingerprint: `fp-${name}`,
        source: crawlSource, output: { relevance: "high", confidence: 0.9, subject_relation: "self", competitor_opt_in: false }, provenance: { runId: "t02" },
      });
      const match = matchDecisionStore.create({
        tenantId, companyId, relevanceDecisionId: relevance.decisionId, promptVersion: "1.0.0",
        output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" }, provenance: { runId: "t04" },
      });
      const created = issueStore.apply({ tenantId, companyId, matchDecision: match, relevanceDecision: relevance }).mutation;
      // Simulate production JSON payloads that omit null sourceUpdatedAt.
      for (const record of issueStore.issueArticlesByKey.values()) {
        if (record.issueId === created.issueId) {
          if (linkedUpdatedAt === undefined) delete record.sourceUpdatedAt;
          else record.sourceUpdatedAt = linkedUpdatedAt;
        }
      }

      let kernelCalls = 0;
      const runtime = createT07IssueAnalysisRuntime({
        aiTaskKernel: { execute: async (request) => {
          kernelCalls += 1;
          const isReview = request.outputSchema?.name === "management_perspective_review_v1";
          return {
            data: isReview ? {
              verdict: "pass", violations: [], corrected_analysis: null,
            } : {
              what_happened: ["Peristiwa crawl."], why_matters: ["Perlu dilacak."],
              impacts: [{ text: "Dampak.", source_article_ids: [crawlId] }], risks: [], watch: [],
              claims: [{ claim_id: "c1", text: "Klaim.", source_article_ids: [crawlId] }],
              subject_relation: "unrelated",
            },
            model: { alias: "mini", name: "mini-test-model" },
            correlation: { requestId: request.requestId, providerRequestId: "req_t07" },
            providerResponseId: "resp_t07",
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            latencyMs: 5,
          };
        } },
        openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
        cmsSourceGate: { requirePublishedArticle: async () => crawlSource },
        issueStore, getEffectiveContext: async () => context(),
        authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "issue.analyze",
      });

      const result = await runtime.service.analyze({ tenantId, companyId, issueId: created.issueId });
      assert.equal(kernelCalls, 2);
      assert.equal(result.reused, false);
      assert.equal(result.analysis.evidence[0].sourceArticleId, crawlId);
      assert.equal(result.analysis.evidence[0].updatedAt, null);
    });
  }
});

test("T07 and T13 schemas accept crawl issue source ids (not UUID-only)", () => {
  const crawlId = `crawl:media_indonesia:${"ab".repeat(32)}`;
  assert.ok(crawlId.length > 64, "fixture must exceed the old T13 maxLength of 64");

  const citedItems = T07_OUTPUT_SCHEMA.schema.properties.impacts.items.properties.source_article_ids.items;
  assert.equal(citedItems.format, undefined);
  assert.equal(citedItems.maxLength, 160);

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateT07 = ajv.compile(T07_OUTPUT_SCHEMA.schema);
  assert.equal(validateT07({
    what_happened: ["Peristiwa dari media crawl."],
    why_matters: ["Perlu dilacak di pipeline isu."],
    impacts: [{ text: "Dampak operasional.", source_article_ids: [crawlId] }],
    risks: [],
    watch: [],
    claims: [{ claim_id: "c1", text: "Klaim berbasis crawl.", source_article_ids: [crawlId] }],
    subject_relation: "self",
  }), true, ajv.errorsText(validateT07.errors));

  const t13ArticleId = T13_OUTPUT_SCHEMA.schema.properties.source_references.items.properties.source_article_id;
  assert.equal(t13ArticleId.maxLength, 160);
  const validateT13 = ajv.compile(T13_OUTPUT_SCHEMA.schema);
  assert.equal(validateT13({
    executive_summary: "Ringkasan.",
    issue_narratives: [{ report_item_id: "item-1", narrative: "Narasi.", source_claim_ids: ["c1"] }],
    impact_narrative: { narrative: "Dampak.", source_claim_ids: ["c1"] },
    watch_items: [{ narrative: "Pantau.", source_claim_ids: ["c1"] }],
    source_references: [{ claim_id: "c1", source_article_id: crawlId }],
  }), true, ajv.errorsText(validateT13.errors));
});
