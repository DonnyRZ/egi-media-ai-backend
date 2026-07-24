const test = require("node:test");
const assert = require("node:assert/strict");
const { validateEnvironment } = require("../src/config/environment");
const { assertReadOnlyQuery, createSourceDatabase } = require("../src/database/source-db");
const { ARTICLE_SOURCE_FIELDS, COMPANY_CONTEXT_SOURCE_FIELDS, ARTICLE_SELECT, COMPANY_CONTEXT_SELECT } = require("../src/data/source-contract");
const { DATABASE_OWNERSHIP } = require("../src/database/ownership");

const validEnv = {
  SOURCE_DATABASE_URL: "postgresql://source:secret@localhost:5432/main",
  AI_DATABASE_URL: "postgresql://ai:secret@localhost:5432/ai",
};

test("S00 validates both database URLs", () => {
  const result = validateEnvironment(validEnv);
  assert.equal(result.SOURCE_DATABASE_URL, validEnv.SOURCE_DATABASE_URL);
  assert.equal(result.AI_DATABASE_URL, validEnv.AI_DATABASE_URL);
  assert.throws(() => validateEnvironment({ AI_DATABASE_URL: validEnv.AI_DATABASE_URL }), /SOURCE_DATABASE_URL/);
});

test("source database rejects mutation queries", () => {
  assert.doesNotThrow(() => assertReadOnlyQuery("SELECT id FROM articles"));
  assert.doesNotThrow(() => assertReadOnlyQuery("WITH rows AS (SELECT 1) SELECT * FROM rows"));
  assert.throws(() => assertReadOnlyQuery("UPDATE articles SET title = $1"), /read-only/);
  assert.throws(() => assertReadOnlyQuery("WITH changed AS (UPDATE articles SET title = $1 RETURNING *) SELECT * FROM changed"), /read-only/);
});

test("source adapter exposes only read-only query path", async () => {
  const calls = [];
  const pool = { query: async (...args) => { calls.push(args); return { rows: [{ ok: 1 }] }; }, end: async () => {} };
  const source = createSourceDatabase({ env: validEnv, pool });
  assert.equal(await source.healthCheck(), true);
  assert.deepEqual(calls[0], ["SELECT 1 AS ok", []]);
  await assert.rejects(() => source.query("DELETE FROM articles"), /read-only/);
});

test("source field contract matches backend-owned tables", () => {
  assert.ok(ARTICLE_SOURCE_FIELDS.includes("title"));
  assert.ok(ARTICLE_SOURCE_FIELDS.includes("status"));
  assert.ok(COMPANY_CONTEXT_SOURCE_FIELDS.includes("company"));
  assert.match(ARTICLE_SELECT, /public\.articles/);
  assert.match(COMPANY_CONTEXT_SELECT, /public\.user_profiles/);
});

test("S00 ownership keeps source domain read-only and AI tables isolated", () => {
  assert.equal(DATABASE_OWNERSHIP.source.access, "read-only");
  assert.equal(DATABASE_OWNERSHIP.source.schema, "public");
  assert.equal(DATABASE_OWNERSHIP.ai.access, "read-write");
  assert.equal(DATABASE_OWNERSHIP.ai.schema, "ai");
  assert.ok(DATABASE_OWNERSHIP.ai.tables.includes("issues"));
  assert.ok(!DATABASE_OWNERSHIP.source.tables.includes("issues"));
});
