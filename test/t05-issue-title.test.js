const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryRelevanceDecisionStore } = require("../src/ai/tasks/t02-relevance-class");
const { InMemoryIssueMatchDecisionStore } = require("../src/ai/tasks/t04-issue-match");
const { InMemoryIssueStore } = require("../src/issues");
const { createT05IssueTitleRuntime } = require("../src/ai/tasks/t05-issue-title");
const { T05_PROMPT_VERSION } = require("../src/ai/tasks/t05-issue-title/definition");
const { fingerprint } = require("../src/ai/tasks/t02-relevance-class/service");

const tenantId = "tenant-h";
const companyId = "company-a";
const articleId = "123e4567-e89b-12d3-a456-426614174000";

function source({ updatedAt = "2026-07-22T11:00:00.000Z" } = {}) {
  return {
    sourceArticleId: articleId, requestedLocale: "id", contentLocale: "id",
    canonicalUrl: `https://portal.example/id/articles/${articleId}`,
    article: {
      id: articleId, title: "New logistics regulation", summary: "A new regulation affects fleet operators.",
      content: "This full article body must not be sent to T05.", status: "published",
      publishedAt: "2026-07-22T10:00:00.000Z", updatedAt,
    },
  };
}

function buildRuntime({ output = { title: "Regulasi Baru untuk Operator Logistik" }, sourceResult = source(), onKernelRequest } = {}) {
  const relevanceDecisionStore = new InMemoryRelevanceDecisionStore({ uuid: () => "relevance-1", now: () => 0 });
  const matchDecisionStore = new InMemoryIssueMatchDecisionStore({ uuid: () => "match-1", now: () => 0 });
  const issueStore = new InMemoryIssueStore({ now: () => Date.parse("2026-07-22T12:00:00.000Z") });
  const initialSource = source();
  const relevanceDecision = relevanceDecisionStore.create({
    articleId, companyId, contextVersion: 3,
    inputFingerprint: fingerprint({ source: initialSource, contextVersion: 3 }), source: initialSource,
    output: { relevance: "high", confidence: 0.9, subject_relation: "self", competitor_opt_in: false }, provenance: { runId: "t02-run" },
  });
  const matchDecision = matchDecisionStore.create({
    tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId, promptVersion: "1.0.0",
    output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" }, provenance: { runId: "t04-run" },
  });
  const mutation = issueStore.apply({ tenantId, companyId, matchDecision, relevanceDecision }).mutation;
  let kernelCalls = 0;
  const runtime = createT05IssueTitleRuntime({
    aiTaskKernel: {
      execute: async (request) => {
        kernelCalls += 1;
        onKernelRequest?.(request);
        return {
          data: output, model: { alias: "nano", name: "nano-test-model" },
          correlation: { requestId: request.requestId, providerRequestId: "req_t05" },
          providerResponseId: "resp_t05", usage: { inputTokens: 22, outputTokens: 8, totalTokens: 30 }, latencyMs: 12,
        };
      },
    },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    cmsSourceGate: { requirePublishedArticle: async () => sourceResult },
    issueStore, matchDecisionStore, relevanceDecisionStore,
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "issue.title.generate",
  });
  return { runtime, issueStore, matchDecisionStore, mutation, kernelCalls: () => kernelCalls };
}

test("T05 generates a bounded title only for a titleless active issue and leaves T04 unchanged", async () => {
  let input;
  const { runtime, issueStore, matchDecisionStore, mutation, kernelCalls } = buildRuntime({ onKernelRequest: (request) => { input = request.input; } });
  const matchingBefore = matchDecisionStore.getById("match-1");

  const result = await runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId });

  assert.equal(kernelCalls(), 1);
  assert.equal(result.reused, false);
  assert.equal(result.title.title, "Regulasi Baru untuk Operator Logistik");
  assert.equal(result.issue.title, "Regulasi Baru untuk Operator Logistik");
  assert.equal(result.issue.version, 2);
  assert.deepEqual(matchDecisionStore.getById("match-1"), matchingBefore);
  assert.match(input[1].content, /<TRUSTED_CONTEXT>/);
  assert.match(input[1].content, /<UNTRUSTED_ARTICLE_DATA>/);
  assert.match(input[1].content, /New logistics regulation/);
  assert.doesNotMatch(input[1].content, /This full article body must not be sent to T05/);
  assert.equal(issueStore.getGeneratedTitle({ issueId: mutation.issueId, developmentId: mutation.developmentId, promptVersion: T05_PROMPT_VERSION }).title, result.title.title);
});

test("T05 is idempotent after a successful title write", async () => {
  const { runtime, mutation, kernelCalls } = buildRuntime();
  const first = await runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId });
  const second = await runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId });
  assert.equal(second.reused, true);
  assert.equal(second.title.titleGenerationId, first.title.titleGenerationId);
  assert.equal(kernelCalls(), 1);
});

test("T05 rejects invalid output without writing the title or touching the match", async () => {
  const { runtime, issueStore, matchDecisionStore, mutation } = buildRuntime({ output: { title: "https://invented.example" } });
  const matchingBefore = matchDecisionStore.getById("match-1");

  await assert.rejects(runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId }), { code: "AI_OUTPUT_SCHEMA_INVALID" });
  assert.equal(issueStore.getIssue({ tenantId, companyId, issueId: mutation.issueId }).title, null);
  assert.deepEqual(matchDecisionStore.getById("match-1"), matchingBefore);
  assert.equal(runtime.runStore.list()[0].validationOutcome, "failed");
});

test("T05 rejects a title that exceeds the bounded length", async () => {
  const { runtime, issueStore, mutation } = buildRuntime({ output: { title: "x".repeat(161) } });
  await assert.rejects(runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId }), { code: "AI_OUTPUT_SCHEMA_INVALID" });
  assert.equal(issueStore.getIssue({ tenantId, companyId, issueId: mutation.issueId }).title, null);
});

test("T05 does not call the model for an issue that already has a title, is selesai, or has stale source", async (t) => {
  await t.test("already titled", async () => {
    const { runtime, issueStore, mutation, kernelCalls } = buildRuntime();
    issueStore.issuesById.get(mutation.issueId).title = "Existing title";
    const result = await runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId });
    assert.equal(result.reused, true);
    assert.equal(result.title.title, "Existing title");
    assert.equal(kernelCalls(), 0);
  });

  await t.test("selesai", async () => {
    const { runtime, issueStore, mutation, kernelCalls } = buildRuntime();
    issueStore.issuesById.get(mutation.issueId).status = "selesai";
    await assert.rejects(runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });

  await t.test("stale source", async () => {
    const { runtime, mutation, kernelCalls } = buildRuntime({ sourceResult: source({ updatedAt: "2026-07-23T11:00:00.000Z" }) });
    await assert.rejects(runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });
});
