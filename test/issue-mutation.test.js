const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryRelevanceDecisionStore } = require("../src/ai/tasks/t02-relevance-class");
const { InMemoryIssueMatchDecisionStore } = require("../src/ai/tasks/t04-issue-match");
const { createIssueMutationRuntime } = require("../src/issues");

const tenantId = "tenant-h";
const companyId = "company-a";

function source(articleId, updatedAt = "2026-07-22T11:00:00.000Z") {
  return {
    sourceArticleId: articleId, requestedLocale: "id", contentLocale: "id",
    canonicalUrl: `https://portal.example/id/articles/${articleId}`,
    article: { publishedAt: "2026-07-22T10:00:00.000Z", updatedAt },
  };
}

function makeRuntime() {
  let relevanceCount = 0;
  let matchCount = 0;
  let issueCount = 0;
  const relevanceDecisionStore = new InMemoryRelevanceDecisionStore({ uuid: () => `relevance-${++relevanceCount}`, now: () => 0 });
  const matchDecisionStore = new InMemoryIssueMatchDecisionStore({ uuid: () => `match-${++matchCount}`, now: () => 0 });
  const runtime = createIssueMutationRuntime({
    matchDecisionStore,
    relevanceDecisionStore,
    issueStore: undefined,
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "issue.mutate",
  });
  runtime.issueStore.uuid = () => `issue-object-${++issueCount}`;
  runtime.issueStore.now = () => Date.parse("2026-07-22T12:00:00.000Z");
  return { runtime, relevanceDecisionStore, matchDecisionStore };
}

function relevance(store, { articleId, contextVersion = 3, updatedAt } = {}) {
  const articleSource = source(articleId, updatedAt);
  return store.create({
    articleId, companyId, contextVersion, inputFingerprint: `fingerprint-${articleId}-${contextVersion}`,
    source: articleSource, output: { relevance: "high", confidence: 0.9 }, provenance: { runId: "t02-run" },
  });
}

function match(store, relevanceDecision, output) {
  return store.create({
    tenantId, companyId, relevanceDecisionId: relevanceDecision.decisionId, promptVersion: "1.0.0",
    output, provenance: { runId: "t04-run" },
  });
}

test("valid T04 new atomically creates a company issue, article relation, and first development", async () => {
  const { runtime, relevanceDecisionStore, matchDecisionStore } = makeRuntime();
  const relevanceDecision = relevance(relevanceDecisionStore, { articleId: "article-1" });
  const matchDecision = match(matchDecisionStore, relevanceDecision, { decision: "new", candidate_issue_id: null, reason_code: "new_event" });

  const result = await runtime.service.apply({ tenantId, companyId, matchDecisionId: matchDecision.matchDecisionId });
  const issue = runtime.issueStore.getIssue({ tenantId, companyId, issueId: result.mutation.issueId });

  assert.equal(result.reused, false);
  assert.equal(result.mutation.outcome, "applied");
  assert.equal(issue.status, "baru");
  assert.equal(issue.title, null);
  assert.equal(issue.oneLiner, null);
  assert.equal(issue.version, 1);
  assert.equal(runtime.issueStore.listArticles({ issueId: issue.issueId }).length, 1);
  const developments = runtime.issueStore.listDevelopments({ issueId: issue.issueId });
  assert.equal(developments.length, 1);
  assert.equal(developments[0].developmentType, "created");
  assert.equal(developments[0].isMaterial, null);
});

test("replaying the same T04 decision is idempotent and does not duplicate issue evidence or development", async () => {
  const { runtime, relevanceDecisionStore, matchDecisionStore } = makeRuntime();
  const relevanceDecision = relevance(relevanceDecisionStore, { articleId: "article-1" });
  const matchDecision = match(matchDecisionStore, relevanceDecision, { decision: "new", candidate_issue_id: null, reason_code: "new_event" });

  const first = await runtime.service.apply({ tenantId, companyId, matchDecisionId: matchDecision.matchDecisionId });
  const second = await runtime.service.apply({ tenantId, companyId, matchDecisionId: matchDecision.matchDecisionId });

  assert.equal(second.reused, true);
  assert.equal(second.mutation.mutationId, first.mutation.mutationId);
  assert.equal(runtime.issueStore.listArticles({ issueId: first.mutation.issueId }).length, 1);
  assert.equal(runtime.issueStore.listDevelopments({ issueId: first.mutation.issueId }).length, 1);
});

test("valid T04 update attaches a new article and development while preserving the active issue status", async () => {
  const { runtime, relevanceDecisionStore, matchDecisionStore } = makeRuntime();
  const firstRelevance = relevance(relevanceDecisionStore, { articleId: "article-1" });
  const firstMatch = match(matchDecisionStore, firstRelevance, { decision: "new", candidate_issue_id: null, reason_code: "new_event" });
  const created = await runtime.service.apply({ tenantId, companyId, matchDecisionId: firstMatch.matchDecisionId });

  const secondRelevance = relevance(relevanceDecisionStore, { articleId: "article-2" });
  const updateMatch = match(matchDecisionStore, secondRelevance, { decision: "update", candidate_issue_id: created.mutation.issueId, reason_code: "same_event" });
  const updated = await runtime.service.apply({ tenantId, companyId, matchDecisionId: updateMatch.matchDecisionId });
  const issue = runtime.issueStore.getIssue({ tenantId, companyId, issueId: created.mutation.issueId });

  assert.equal(updated.mutation.issueId, created.mutation.issueId);
  assert.equal(updated.mutation.outcome, "applied");
  assert.equal(issue.status, "baru");
  assert.equal(issue.version, 2);
  assert.equal(runtime.issueStore.listArticles({ issueId: issue.issueId }).length, 2);
  const developments = runtime.issueStore.listDevelopments({ issueId: issue.issueId });
  assert.equal(developments.length, 2);
  assert.equal(developments[1].developmentType, "updated");
});

test("duplicate source evidence from a different valid T04 decision creates neither a duplicate relation nor development", async () => {
  const { runtime, relevanceDecisionStore, matchDecisionStore } = makeRuntime();
  const firstRelevance = relevance(relevanceDecisionStore, { articleId: "article-1", contextVersion: 3 });
  const firstMatch = match(matchDecisionStore, firstRelevance, { decision: "new", candidate_issue_id: null, reason_code: "new_event" });
  const created = await runtime.service.apply({ tenantId, companyId, matchDecisionId: firstMatch.matchDecisionId });
  const secondRelevance = relevance(relevanceDecisionStore, { articleId: "article-1", contextVersion: 4 });
  const updateMatch = match(matchDecisionStore, secondRelevance, { decision: "update", candidate_issue_id: created.mutation.issueId, reason_code: "same_event" });

  const duplicate = await runtime.service.apply({ tenantId, companyId, matchDecisionId: updateMatch.matchDecisionId });
  assert.equal(duplicate.mutation.outcome, "evidence_already_attached");
  assert.equal(duplicate.mutation.developmentId, null);
  assert.equal(runtime.issueStore.listArticles({ issueId: created.mutation.issueId }).length, 1);
  assert.equal(runtime.issueStore.listDevelopments({ issueId: created.mutation.issueId }).length, 1);
});

test("issue mutation rejects cross-scope and selesai update without partial writes", async (t) => {
  await t.test("cross-tenant call", async () => {
    const { runtime, relevanceDecisionStore, matchDecisionStore } = makeRuntime();
    const relevanceDecision = relevance(relevanceDecisionStore, { articleId: "article-1" });
    const matchDecision = match(matchDecisionStore, relevanceDecision, { decision: "new", candidate_issue_id: null, reason_code: "new_event" });
    await assert.rejects(runtime.service.apply({ tenantId: "tenant-other", companyId, matchDecisionId: matchDecision.matchDecisionId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(runtime.issueStore.issuesById.size, 0);
  });

  await t.test("selesai issue", async () => {
    const { runtime, relevanceDecisionStore, matchDecisionStore } = makeRuntime();
    runtime.issueStore.seed({
      issueId: "finished-issue", tenantId, companyId, status: "selesai", title: "Archived", oneLiner: "Archived", currentPriority: null,
      firstSeenAt: "2026-07-20T00:00:00.000Z", lastDevelopedAt: "2026-07-20T00:00:00.000Z", version: 1, closedAt: "2026-07-21T00:00:00.000Z", createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z",
    });
    const relevanceDecision = relevance(relevanceDecisionStore, { articleId: "article-1" });
    const matchDecision = match(matchDecisionStore, relevanceDecision, { decision: "update", candidate_issue_id: "finished-issue", reason_code: "same_event" });
    await assert.rejects(runtime.service.apply({ tenantId, companyId, matchDecisionId: matchDecision.matchDecisionId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(runtime.issueStore.listArticles({ issueId: "finished-issue" }).length, 0);
    assert.equal(runtime.issueStore.listDevelopments({ issueId: "finished-issue" }).length, 0);
  });

  await t.test("invalid T04 shape", async () => {
    const { runtime, relevanceDecisionStore, matchDecisionStore } = makeRuntime();
    const relevanceDecision = relevance(relevanceDecisionStore, { articleId: "article-1" });
    const matchDecision = match(matchDecisionStore, relevanceDecision, { decision: "new", candidate_issue_id: null, reason_code: "same_event" });
    await assert.rejects(runtime.service.apply({ tenantId, companyId, matchDecisionId: matchDecision.matchDecisionId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(runtime.issueStore.issuesById.size, 0);
  });
});
