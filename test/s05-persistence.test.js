const test = require("node:test");
const assert = require("node:assert/strict");
const { PostgresRecordStore, PostgresRelevanceDecisionStore, PostgresIssueAnalysisStore, createPostgresPersistence } = require("../src/persistence");

function fakeDb(rows = []) {
  const calls = [];
  return { calls, async query(sql, values) { calls.push({ sql, values }); return { rows }; } };
}

test("S05 repository base scopes reads by tenant and company", async () => {
  const db = fakeDb([{ id: "r1", payload_jsonb: { value: 1 } }]);
  const store = new PostgresRecordStore({ db, table: "ai.test_records" });
  assert.deepEqual(await store.findOne({ id: "r1", tenantId: "t1", companyId: "c1" }), { value: 1 });
  assert.deepEqual(db.calls[0].values, ["r1", "t1", "c1"]);
  assert.match(db.calls[0].sql, /tenant_id = \$2/);
  assert.match(db.calls[0].sql, /company_id = \$3/);
});

test("S05 relevance repository uses the blueprint uniqueness key", async () => {
  const db = fakeDb([{ id: "d1", relevance: "high", confidence: "0.9", payload_jsonb: { inputFingerprint: "fp" }, created_at: new Date("2026-01-01T00:00:00Z") }]);
  const store = new PostgresRelevanceDecisionStore({ db, uuid: () => "d-new" });
  const result = await store.get({ articleId: "a1", companyId: "c1", contextVersion: "ctx-v1", inputFingerprint: "fp" });
  assert.equal(result.decisionId, "d1");
  assert.equal(result.relevance, "high");
  assert.equal(db.calls[0].values.join("|"), "c1|a1|ctx-v1|fp");
});

test("S05 persistence factory exposes stores without changing service rules", () => {
  const persistence = createPostgresPersistence({ db: fakeDb() });
  assert.ok(persistence.relevanceDecisionStore instanceof PostgresRelevanceDecisionStore);
  assert.ok(persistence.analysisStore instanceof PostgresIssueAnalysisStore);
  assert.equal(typeof persistence.matchDecisionStore.create, "function");
});
