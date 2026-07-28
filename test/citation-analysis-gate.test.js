const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryRelevanceDecisionStore } = require("../src/ai/tasks/t02-relevance-class");
const { InMemoryIssueMatchDecisionStore } = require("../src/ai/tasks/t04-issue-match");
const { InMemoryIssueStore } = require("../src/issues");
const { InMemoryIssueAnalysisStore } = require("../src/ai/tasks/t07-issue-analysis");
const { InMemoryClaimLabelStore } = require("../src/ai/tasks/t08-claim-labels");
const { CitationAnalysisGate } = require("../src/analysis");

const tenantId = "tenant-h";
const companyId = "company-a";
const articleId = "123e4567-e89b-12d3-a456-426614174000";

function source({ canonicalUrl = `https://portal.example/id/articles/${articleId}`, updatedAt = "2026-07-22T11:00:00.000Z" } = {}) {
  return { sourceArticleId: articleId, requestedLocale: "id", contentLocale: "id", canonicalUrl, article: { publishedAt: "2026-07-22T10:00:00.000Z", updatedAt } };
}

function buildGate() {
  const relevanceStore = new InMemoryRelevanceDecisionStore();
  const matchStore = new InMemoryIssueMatchDecisionStore();
  const issueStore = new InMemoryIssueStore();
  const analysisStore = new InMemoryIssueAnalysisStore({ now: () => 0 });
  const labelStore = new InMemoryClaimLabelStore({ now: () => 0 });
  const storedSource = source();
  const relevance = relevanceStore.create({ articleId, companyId, contextVersion: 3, inputFingerprint: "relevance-fp", source: storedSource, output: { relevance: "high", confidence: 0.9, subject_relation: "self", competitor_opt_in: false }, provenance: {} });
  const match = matchStore.create({ tenantId, companyId, relevanceDecisionId: relevance.decisionId, promptVersion: "1.0.0", output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" }, provenance: {} });
  const mutation = issueStore.apply({ tenantId, companyId, matchDecision: match, relevanceDecision: relevance }).mutation;
  let sourceResult = source();
  const gate = new CitationAnalysisGate({
    cmsSourceGate: { requirePublishedArticle: async () => sourceResult }, issueStore, analysisStore, labelStore,
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "analysis.citation_gate",
    now: () => 0,
  });
  return { gate, issueStore, analysisStore, labelStore, issueId: mutation.issueId, setSource: (value) => { sourceResult = value; } };
}

function createAnalysis(analysisStore, { issueId, fingerprint = "analysis-fp", evidence = [source()], claimSourceIds = [articleId] }) {
  return analysisStore.create({
    tenantId, companyId, issueId, contextVersion: 3, inputFingerprint: fingerprint, promptVersion: "1.0.0",
    analysis: {
      what_happened: ["Regulasi diumumkan."], why_matters: ["Operasi dapat berubah."],
      impacts: [{ text: "Perlu penyesuaian.", source_article_ids: claimSourceIds }], risks: [], watch: [],
      claims: [{ claim_id: "c1", text: "Regulasi menyasar operator.", source_article_ids: claimSourceIds }],
    }, evidence, provenance: {},
  });
}

function labelAll(labelStore, analysis) {
  return labelStore.create({ tenantId, companyId, analysisId: analysis.analysisId, issueId: analysis.issueId, promptVersion: "1.0.0", labels: analysis.analysis.claims.map((claim) => ({ claim_id: claim.claim_id, label: "fact" })), provenance: {} });
}

test("citation gate promotes only a fully scoped, canonical, cited, and labeled analysis to current", async () => {
  const { gate, analysisStore, labelStore, issueId } = buildGate();
  const analysis = createAnalysis(analysisStore, { issueId });
  labelAll(labelStore, analysis);
  const current = await gate.validateAndPromote({ tenantId, companyId, analysisId: analysis.analysisId });
  assert.equal(current.status, "current");
  assert.equal(current.gate.citationStatus, "passed");
  assert.equal(analysisStore.getCurrent({ tenantId, companyId, issueId }).analysisId, analysis.analysisId);
});

test("invalid citation, canonical URL, or evidence subset cannot replace a current analysis", async (t) => {
  for (const [name, buildInvalid] of [
    ["unknown source ID", ({ analysisStore, issueId }) => createAnalysis(analysisStore, { issueId, fingerprint: "invalid-source", claimSourceIds: ["123e4567-e89b-12d3-a456-426614174099"] })],
    ["non-canonical URL", ({ analysisStore, issueId }) => createAnalysis(analysisStore, { issueId, fingerprint: "invalid-url", evidence: [source({ canonicalUrl: "https://evil.example/articles/x" })] })],
    ["evidence subset mismatch", ({ analysisStore, issueId }) => createAnalysis(analysisStore, { issueId, fingerprint: "invalid-subset", evidence: [] })],
  ]) {
    await t.test(name, async () => {
      const setup = buildGate();
      const valid = createAnalysis(setup.analysisStore, { issueId: setup.issueId, fingerprint: `valid-${name}` });
      labelAll(setup.labelStore, valid);
      await setup.gate.validateAndPromote({ tenantId, companyId, analysisId: valid.analysisId });
      const invalid = buildInvalid({ analysisStore: setup.analysisStore, issueId: setup.issueId });
      labelAll(setup.labelStore, invalid);
      await assert.rejects(setup.gate.validateAndPromote({ tenantId, companyId, analysisId: invalid.analysisId }), { code: "AI_CONFIGURATION_INVALID" });
      assert.equal(setup.analysisStore.getById(invalid.analysisId).status, "validated");
      assert.equal(setup.analysisStore.getCurrent({ tenantId, companyId, issueId: setup.issueId }).analysisId, valid.analysisId);
    });
  }
});

test("analysis without complete T08 labels cannot become current", async () => {
  const { gate, analysisStore, issueId } = buildGate();
  const analysis = createAnalysis(analysisStore, { issueId });
  await assert.rejects(gate.validateAndPromote({ tenantId, companyId, analysisId: analysis.analysisId }), { code: "AI_CONFIGURATION_INVALID" });
  assert.equal(analysisStore.getCurrent({ tenantId, companyId, issueId }), null);
  assert.equal(analysisStore.getById(analysis.analysisId).status, "validated");
});

test("citation gate accepts crawl evidence when updatedAt is intentionally null", async () => {
  const crawlId = "crawl:detik:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const mediaUrl = "https://news.detik.com/berita/artikel-asli";
  const relevanceStore = new InMemoryRelevanceDecisionStore();
  const matchStore = new InMemoryIssueMatchDecisionStore();
  const issueStore = new InMemoryIssueStore();
  const analysisStore = new InMemoryIssueAnalysisStore({ now: () => 0 });
  const labelStore = new InMemoryClaimLabelStore({ now: () => 0 });
  const crawlSource = {
    sourceArticleId: crawlId,
    requestedLocale: "id",
    contentLocale: "id",
    canonicalUrl: mediaUrl,
    article: { publishedAt: "2026-07-26T10:00:00.000Z", updatedAt: null },
  };
  const relevance = relevanceStore.create({
    articleId: crawlId, companyId, contextVersion: 3, inputFingerprint: "crawl-relevance-fp",
    source: crawlSource, output: { relevance: "high", confidence: 0.9, subject_relation: "self", competitor_opt_in: false }, provenance: {},
  });
  const match = matchStore.create({
    tenantId, companyId, relevanceDecisionId: relevance.decisionId, promptVersion: "1.0.0",
    output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" }, provenance: {},
  });
  const mutation = issueStore.apply({ tenantId, companyId, matchDecision: match, relevanceDecision: relevance }).mutation;
  const gate = new CitationAnalysisGate({
    cmsSourceGate: {
      requirePublishedArticle: async () => ({
        sourceArticleId: crawlId,
        requestedLocale: "id",
        contentLocale: "id",
        canonicalUrl: mediaUrl,
        article: { publishedAt: "2026-07-26T10:00:00.000Z", updatedAt: null },
      }),
    },
    issueStore, analysisStore, labelStore,
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId,
    now: () => 0,
  });
  const analysis = analysisStore.create({
    tenantId, companyId, issueId: mutation.issueId, contextVersion: 3, inputFingerprint: "crawl-analysis-fp",
    promptVersion: "1.0.0",
    analysis: {
      what_happened: ["Berita media."], why_matters: ["Relevan."],
      impacts: [{ text: "Dampak.", source_article_ids: [crawlId] }], risks: [], watch: [],
      claims: [{ claim_id: "c1", text: "Klaim.", source_article_ids: [crawlId] }],
    },
    evidence: [crawlSource],
    provenance: {},
  });
  labelAll(labelStore, analysis);
  const current = await gate.validateAndPromote({ tenantId, companyId, analysisId: analysis.analysisId });
  assert.equal(current.status, "current");
  assert.equal(current.gate.citationStatus, "passed");
});
