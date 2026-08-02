const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryRelevanceDecisionStore } = require("../src/ai/tasks/t02-relevance-class");
const { InMemoryIssueMatchDecisionStore } = require("../src/ai/tasks/t04-issue-match");
const { InMemoryIssueStore } = require("../src/issues");
const { createT06IssueOneLinerRuntime } = require("../src/ai/tasks/t06-issue-oneliner");
const { fingerprint } = require("../src/ai/tasks/t02-relevance-class/service");
const { readyManagementIdentity } = require("./support/management-context");

const tenantId = "tenant-h";
const companyId = "company-a";
const articleId = "123e4567-e89b-12d3-a456-426614174000";

function source({ updatedAt = "2026-07-22T11:00:00.000Z" } = {}) {
  return {
    sourceArticleId: articleId, requestedLocale: "id", contentLocale: "id", canonicalUrl: `https://portal.example/id/articles/${articleId}`,
    article: {
      id: articleId, title: "New logistics regulation", summary: "A new regulation affects fleet operators.",
      content: "This full article body must not be sent to T06.", status: "published",
      publishedAt: "2026-07-22T10:00:00.000Z", updatedAt,
    },
  };
}

function buildRuntime({ output = { one_liner: "Regulasi baru berpotensi memengaruhi operasional armada perusahaan." }, sourceResult = source(), hasTitle = true, onKernelRequest } = {}) {
  const relevanceDecisionStore = new InMemoryRelevanceDecisionStore({ uuid: () => "relevance-1", now: () => 0 });
  const matchDecisionStore = new InMemoryIssueMatchDecisionStore({ uuid: () => "match-1", now: () => 0 });
  const issueStore = new InMemoryIssueStore({ now: () => Date.parse("2026-07-22T12:00:00.000Z") });
  const initialSource = source();
  const relevanceDecision = relevanceDecisionStore.create({
    articleId, companyId, contextVersion: 3, inputFingerprint: fingerprint({ source: initialSource, contextVersion: 3 }), source: initialSource,
    output: { relevance: "high", confidence: 0.9, subject_relation: "self", competitor_opt_in: false }, provenance: { runId: "t02-run" },
  });
  const matchDecision = matchDecisionStore.create({
    tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId, promptVersion: "1.0.0",
    output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" }, provenance: { runId: "t04-run" },
  });
  const mutation = issueStore.apply({ tenantId, companyId, matchDecision, relevanceDecision }).mutation;
  if (hasTitle) issueStore.issuesById.get(mutation.issueId).title = "Regulasi Baru untuk Operator Logistik";
  let kernelCalls = 0;
  const runtime = createT06IssueOneLinerRuntime({
    aiTaskKernel: { execute: async (request) => {
      kernelCalls += 1; onKernelRequest?.(request);
      return {
        data: output, model: { alias: "nano", name: "nano-test-model" },
        correlation: { requestId: request.requestId, providerRequestId: "req_t06" }, providerResponseId: "resp_t06",
        usage: { inputTokens: 24, outputTokens: 10, totalTokens: 34 }, latencyMs: 13,
      };
    } },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" }, cmsSourceGate: { requirePublishedArticle: async () => sourceResult },
    issueStore, matchDecisionStore, relevanceDecisionStore,
    getEffectiveContext: async () => ({
      companyId, version: 3, status: "effective", fields: { name: "Acme Logistics", industry: "Logistics" },
      managementIdentity: readyManagementIdentity("Acme Logistics"),
    }),
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "issue.one_liner.generate",
  });
  return { runtime, issueStore, matchDecisionStore, mutation, kernelCalls: () => kernelCalls };
}

test("T06 writes one bounded one-liner and completes content readiness without changing T04", async () => {
  let input;
  const { runtime, issueStore, matchDecisionStore, mutation, kernelCalls } = buildRuntime({ onKernelRequest: (request) => { input = request.input; } });
  const matchingBefore = matchDecisionStore.getById("match-1");
  assert.deepEqual(issueStore.getAlertContentReadiness({ tenantId, companyId, issueId: mutation.issueId }), { contentReady: false, missingFields: ["one_liner"] });

  const result = await runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId });

  assert.equal(kernelCalls(), 1);
  assert.equal(result.reused, false);
  assert.equal(result.oneLiner.oneLiner, "Regulasi baru berpotensi memengaruhi operasional armada perusahaan.");
  assert.equal(result.issue.oneLiner, result.oneLiner.oneLiner);
  assert.deepEqual(issueStore.getAlertContentReadiness({ tenantId, companyId, issueId: mutation.issueId }), { contentReady: true, missingFields: [] });
  assert.deepEqual(matchDecisionStore.getById("match-1"), matchingBefore);
  assert.match(input[1].content, /Regulasi Baru untuk Operator Logistik/);
  assert.match(input[1].content, /New logistics regulation/);
  assert.doesNotMatch(input[1].content, /This full article body must not be sent to T06/);
});

test("T06 is idempotent after a successful one-liner write", async () => {
  const { runtime, mutation, kernelCalls } = buildRuntime();
  const first = await runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId });
  const second = await runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId });
  assert.equal(second.reused, true);
  assert.equal(second.oneLiner.oneLinerGenerationId, first.oneLiner.oneLinerGenerationId);
  assert.equal(kernelCalls(), 1);
});

test("T06 failure preserves the issue and leaves alert content readiness false", async () => {
  const { runtime, issueStore, mutation } = buildRuntime({ output: { one_liner: "x".repeat(281) } });
  await assert.rejects(runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId }), { code: "AI_OUTPUT_SCHEMA_INVALID" });
  const issue = issueStore.getIssue({ tenantId, companyId, issueId: mutation.issueId });
  assert.equal(issue.status, "baru");
  assert.equal(issue.oneLiner, null);
  assert.deepEqual(issueStore.getAlertContentReadiness({ tenantId, companyId, issueId: mutation.issueId }), { contentReady: false, missingFields: ["one_liner"] });
  assert.equal(runtime.runStore.list()[0].validationOutcome, "failed");
});

test("T06 does not call the model without a title, for selesai issue, or stale source", async (t) => {
  await t.test("missing title", async () => {
    const { runtime, mutation, kernelCalls } = buildRuntime({ hasTitle: false });
    await assert.rejects(runtime.service.generate({ tenantId, companyId, issueId: mutation.issueId }), { code: "AI_CONFIGURATION_INVALID" });
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
