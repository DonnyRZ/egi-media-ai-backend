const assert = require("node:assert/strict");
const test = require("node:test");

const { withPipelineTrace } = require("../src/pipeline/pipeline-trace");
const { InMemoryIssueStore } = require("../src/issues/issue.store");
const { PostgresClaimLabelStore } = require("../src/persistence/postgres-stage-stores");
const { PostgresIssueMatchDecisionStore, PostgresRelevanceDecisionStore } = require("../src/persistence/postgres-stores");

function fakeDb() {
  const calls = [];
  return {
    calls,
    db: {
      query: async (sql, values = []) => {
        calls.push({ sql, values });
        return { rows: [] };
      },
    },
  };
}

test("pipeline trace adds bounded run and context identifiers", () => {
  assert.deepEqual(withPipelineTrace({ runId: "run-1" }, "pipeline-1", {
    version: 3,
    managementIdentity: { fingerprint: "identity-fp-1" },
  }), {
    runId: "run-1",
    pipelineId: "pipeline-1",
    contextVersion: 3,
    identityFingerprint: "identity-fp-1",
  });
  assert.deepEqual(withPipelineTrace({ runId: "run-1" }, null), { runId: "run-1" });
});

test("Postgres stage stores persist pipeline and provider trace columns", async () => {
  const { db, calls } = fakeDb();
  const store = new PostgresClaimLabelStore({ db, uuid: () => "label-1" });
  await store.create({
    tenantId: "tenant-1",
    companyId: "company-1",
    analysisId: "analysis-1",
    issueId: "issue-1",
    promptVersion: "1.8.0",
    labels: [{ claim_id: "claim-1", label: "fact" }],
    pipelineId: "pipeline-1",
    inputFingerprint: "input-fp-1",
    provenance: {
      model: "mini-model",
      promptId: "T08",
      providerRequestId: "provider-req-1",
      createdAt: "2026-08-02T00:00:00.000Z",
    },
  });
  const insert = calls.find((call) => call.sql.startsWith("INSERT INTO ai.stage_runs"));
  assert.ok(insert);
  assert.equal(insert.values[1], "pipeline-1");
  assert.equal(insert.values[5], "input-fp-1");
  assert.equal(insert.values[7], "mini-model");
  assert.equal(insert.values[8], "T08");
  assert.equal(insert.values[10], "provider-req-1");
  assert.equal(insert.values[12], "2026-08-02T00:00:00.000Z");
  assert.equal(JSON.parse(insert.values[14]).pipelineId, "pipeline-1");
});

test("Postgres T04 and T02 persistence retain pipeline trace in new rows", async () => {
  const t04 = fakeDb();
  const matchStore = new PostgresIssueMatchDecisionStore({ db: t04.db, uuid: () => "match-1" });
  await matchStore.create({
    tenantId: "tenant-1", companyId: "company-1", relevanceDecisionId: "decision-1", promptVersion: "1.4.0",
    output: { decision: "new", candidate_issue_id: null, reason_code: "new_event" },
    pipelineId: "pipeline-1", inputFingerprint: "input-fp-2",
    provenance: { model: "nano-model", promptId: "T04", providerRequestId: "provider-req-2", createdAt: "2026-08-02T00:01:00.000Z" },
  });
  const t04Insert = t04.calls[0];
  assert.equal(t04Insert.values[1], "pipeline-1");
  assert.equal(t04Insert.values[4], "input-fp-2");
  assert.equal(t04Insert.values[9], "provider-req-2");

  const t02 = fakeDb();
  const relevanceStore = new PostgresRelevanceDecisionStore({ db: t02.db, uuid: () => "decision-1" });
  await relevanceStore.create({
    tenantId: "tenant-1", companyId: "company-1", articleId: "article-1", contextVersion: 2, identityFingerprint: "identity-fp-3", inputFingerprint: "input-fp-3",
    source: {
      sourceArticleId: "article-1", canonicalUrl: "https://example.test/article-1", requestedLocale: "id", contentLocale: "id",
      article: { publishedAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" },
    },
    output: { relevance: "none", confidence: 0.9, subject_relation: "unrelated", competitor_opt_in: false },
    pipelineId: "pipeline-1", provenance: { requestId: "request-1", pipelineId: "pipeline-1" },
  });
  const t02Insert = t02.calls.find((call) => call.sql.startsWith("INSERT INTO ai.article_relevance"));
  assert.equal(JSON.parse(t02Insert.values[7]).pipelineId, "pipeline-1");
  assert.equal(JSON.parse(t02Insert.values[7]).inputFingerprint, "input-fp-3");
  assert.equal(JSON.parse(t02Insert.values[7]).identityFingerprint, "identity-fp-3");
});

test("issue aggregate retains T05/T06 pipeline trace in its durable payload", () => {
  const store = new InMemoryIssueStore({ uuid: () => "generation-1", now: () => 0 });
  store.seed({
    issueId: "issue-1", tenantId: "tenant-1", companyId: "company-1", status: "baru", version: 1,
    title: null, oneLiner: null, firstSeenAt: "2026-08-02T00:00:00.000Z", lastDevelopedAt: "2026-08-02T00:00:00.000Z",
    createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", closedAt: null,
  });
  store.applyGeneratedTitle({
    tenantId: "tenant-1", companyId: "company-1", issueId: "issue-1", developmentId: "development-1",
    promptVersion: "1.5.0", title: "A grounded issue title", pipelineId: "pipeline-1",
    provenance: { providerRequestId: "provider-req-5" },
  });
  const issue = store.getIssue({ tenantId: "tenant-1", companyId: "company-1", issueId: "issue-1" });
  assert.equal(issue.aiOutputTrace.T05.pipelineId, "pipeline-1");
  assert.equal(issue.aiOutputTrace.T05.provenance.providerRequestId, "provider-req-5");
});
