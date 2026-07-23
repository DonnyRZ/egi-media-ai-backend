const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryRelevanceDecisionStore } = require("../src/ai/tasks/t02-relevance-class");
const { createT04IssueMatchRuntime } = require("../src/ai/tasks/t04-issue-match");
const { fingerprint } = require("../src/ai/tasks/t02-relevance-class/service");

const tenantId = "tenant-h";
const companyId = "company-a";
const articleId = "123e4567-e89b-12d3-a456-426614174000";
const activeIssueId = "123e4567-e89b-12d3-a456-426614174001";
const completedIssueId = "123e4567-e89b-12d3-a456-426614174002";
const otherTenantIssueId = "123e4567-e89b-12d3-a456-426614174003";

function source({ updatedAt = "2026-07-22T11:00:00.000Z" } = {}) {
  return {
    sourceArticleId: articleId, requestedLocale: "id", contentLocale: "id",
    canonicalUrl: `https://portal.example/id/articles/${articleId}`,
    article: {
      id: articleId, title: "New logistics regulation", summary: "A new regulation affects fleet operators.",
      content: "This full article body must not be sent to T04.", status: "published",
      publishedAt: "2026-07-22T10:00:00.000Z", updatedAt,
    },
  };
}

function issue({ issueId, tenant = tenantId, company = companyId, status = "berkembang" }) {
  return {
    issueId, tenantId: tenant, companyId: company, status,
    title: `Issue ${issueId.slice(-1)}`, oneLiner: "Existing issue summary.", lastDevelopedAt: "2026-07-22T08:00:00.000Z",
  };
}

function buildRuntime({ output = { decision: "update", candidate_issue_id: activeIssueId, reason_code: "same_event" }, sourceResult = source(), seedIssues = [issue({ issueId: activeIssueId })], issueCandidateStore, onKernelRequest } = {}) {
  const decisionStore = new InMemoryRelevanceDecisionStore({ uuid: () => "decision-1", now: () => 0 });
  const initialSource = source();
  const relevanceDecision = decisionStore.create({
    articleId, companyId, contextVersion: 3,
    inputFingerprint: fingerprint({ source: initialSource, contextVersion: 3 }),
    source: initialSource, output: { relevance: "high", confidence: 0.9 }, provenance: { runId: "run-t02" },
  });
  let kernelCalls = 0;
  const runtime = createT04IssueMatchRuntime({
    aiTaskKernel: {
      execute: async (request) => {
        kernelCalls += 1;
        onKernelRequest?.(request);
        return {
          data: output, model: { alias: "nano", name: "nano-test-model" },
          correlation: { requestId: request.requestId, providerRequestId: "req_t04" },
          providerResponseId: "resp_t04", usage: { inputTokens: 30, outputTokens: 8, totalTokens: 38 }, latencyMs: 14,
        };
      },
    },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    cmsSourceGate: { requirePublishedArticle: async () => sourceResult },
    decisionStore,
    issueCandidateStore,
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "issue.match",
  });
  for (const record of seedIssues) runtime.issueCandidateStore.seed(record);
  return { runtime, decisionStore, relevanceDecision, kernelCalls: () => kernelCalls };
}

test("T04 selects only a same-tenant/company active candidate and does not mutate the issue", async () => {
  let input;
  const { runtime, relevanceDecision, kernelCalls } = buildRuntime({ onKernelRequest: (request) => { input = request.input; } });

  const result = await runtime.service.match({ tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId });

  assert.equal(kernelCalls(), 1);
  assert.equal(result.match.decision, "update");
  assert.equal(result.match.candidateIssueId, activeIssueId);
  assert.equal(result.reused, false);
  assert.match(input[1].content, new RegExp(activeIssueId));
  assert.match(input[1].content, /<UNTRUSTED_ARTICLE_DATA>/);
  assert.doesNotMatch(input[1].content, /This full article body must not be sent to T04/);
  assert.equal(runtime.matchDecisionStore.list().length, 1);
});

test("T04 excludes selesai and other-tenant issues; selesai policy defaults to new without reopen", async () => {
  let input;
  const { runtime, relevanceDecision, kernelCalls } = buildRuntime({
    output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" },
    seedIssues: [
      issue({ issueId: completedIssueId, status: "selesai" }),
      issue({ issueId: otherTenantIssueId, tenant: "tenant-other" }),
    ],
    onKernelRequest: (request) => { input = request.input; },
  });

  const result = await runtime.service.match({ tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId });

  assert.equal(kernelCalls(), 1);
  assert.equal(result.match.decision, "new");
  assert.equal(result.match.candidateIssueId, null);
  assert.doesNotMatch(input[1].content, new RegExp(completedIssueId));
  assert.doesNotMatch(input[1].content, new RegExp(otherTenantIssueId));
});

test("T04 rejects a candidate outside the validated candidate set without persisting a decision", async () => {
  const { runtime, relevanceDecision } = buildRuntime({
    output: { decision: "update", candidate_issue_id: otherTenantIssueId, reason_code: "same_event" },
  });
  await assert.rejects(
    runtime.service.match({ tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId }),
    { code: "AI_OUTPUT_SCHEMA_INVALID" },
  );
  assert.deepEqual(runtime.matchDecisionStore.list(), []);
  assert.equal(runtime.runStore.list()[0].validationOutcome, "failed");
});

test("T04 rejects an attempted update to a selesai issue; it cannot auto-reopen", async () => {
  const { runtime, relevanceDecision } = buildRuntime({
    output: { decision: "update", candidate_issue_id: completedIssueId, reason_code: "same_event" },
    seedIssues: [issue({ issueId: completedIssueId, status: "selesai" })],
  });
  await assert.rejects(
    runtime.service.match({ tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId }),
    { code: "AI_OUTPUT_SCHEMA_INVALID" },
  );
  assert.deepEqual(runtime.matchDecisionStore.list(), []);
});

test("T04 fails before model call for none relevance, stale source, or a cross-scope candidate store", async (t) => {
  await t.test("none relevance", async () => {
    const { runtime, decisionStore, relevanceDecision, kernelCalls } = buildRuntime();
    const raw = decisionStore.decisionsById.get(relevanceDecision.decisionId);
    raw.relevance = "none";
    raw.branch = "stop";
    await assert.rejects(runtime.service.match({ tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });

  await t.test("stale source", async () => {
    const { runtime, relevanceDecision, kernelCalls } = buildRuntime({ sourceResult: source({ updatedAt: "2026-07-23T11:00:00.000Z" }) });
    await assert.rejects(runtime.service.match({ tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });

  await t.test("malicious cross-scope list", async () => {
    const crossScopeStore = { listActive: () => [issue({ issueId: otherTenantIssueId, tenant: "tenant-other" })] };
    const { runtime, relevanceDecision, kernelCalls } = buildRuntime({ issueCandidateStore: crossScopeStore, seedIssues: [] });
    await assert.rejects(runtime.service.match({ tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });
});
