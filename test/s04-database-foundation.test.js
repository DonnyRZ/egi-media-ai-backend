const test = require("node:test");
const assert = require("node:assert/strict");
const { withTransaction } = require("../src/database/transaction");
const { checkDatabaseHealth } = require("../src/database/health");
const { migrationFiles, MIGRATION_LOCK_NAME, migrate } = require("../scripts/migrate-ai-db");

test("S04 transaction helper commits and releases the client", async () => {
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql); return { rows: [] }; }, release: () => calls.push("RELEASE") };
  const pool = { connect: async () => client };
  const value = await withTransaction(pool, async (tx) => { await tx.query("SELECT 1"); return "done"; });
  assert.equal(value, "done");
  assert.deepEqual(calls, ["BEGIN ISOLATION LEVEL READ COMMITTED", "SELECT 1", "COMMIT", "RELEASE"]);
});

test("S04 transaction helper rolls back on failure", async () => {
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql); }, release: () => calls.push("RELEASE") };
  await assert.rejects(() => withTransaction({ connect: async () => client }, async () => { throw new Error("work failed"); }), /work failed/);
  assert.deepEqual(calls, ["BEGIN ISOLATION LEVEL READ COMMITTED", "ROLLBACK", "RELEASE"]);
});

test("S04 source transaction is read-only", async () => {
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql); return { rows: [{ value: 1 }] }; }, release: () => {} };
  const source = require("../src/database/source-db").createSourceDatabase({
    env: { SOURCE_DATABASE_URL: "postgresql://s:x@localhost/s", AI_DATABASE_URL: "postgresql://a:x@localhost/a" },
    pool: { connect: async () => client, query: client.query, end: async () => {} },
  });
  await source.transaction(async (tx) => tx.query("SELECT 1"));
  await assert.rejects(() => source.transaction((tx) => tx.query("UPDATE articles SET title = 'x'")), /read-only/);
  assert.equal(calls[0], "BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
});

test("S04 database health reports both dependencies", async () => {
  const healthy = await checkDatabaseHealth({ source: { healthCheck: async () => true }, ai: { healthCheck: async () => true } });
  assert.deepEqual(healthy, { healthy: true, checks: { source_database: "ok", ai_database: "ok" } });
  const failed = await checkDatabaseHealth({ source: { healthCheck: async () => { throw new Error("down"); } }, ai: { healthCheck: async () => true } });
  assert.deepEqual(failed, { healthy: false, checks: { source_database: "failed", ai_database: "ok" } });
});

test("S04 migration runner uses an advisory lock and applies only unapplied files", async () => {
  const calls = [];
  const client = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } };
  await migrate({ client, env: { SOURCE_DATABASE_URL: "postgresql://s:x@localhost/s", AI_DATABASE_URL: "postgresql://a:x@localhost/a" } });
  assert.equal(calls[0].sql, "SELECT pg_advisory_lock(hashtext($1))");
  assert.equal(calls[0].values[0], MIGRATION_LOCK_NAME);
  assert.ok(calls.some((call) => call.sql.includes("CREATE TABLE IF NOT EXISTS ai.schema_migrations")));
  assert.equal(calls.at(-1).sql, "SELECT pg_advisory_unlock(hashtext($1))");
});

test("S04 migration file discovery is deterministic", () => {
  assert.deepEqual(migrationFiles(require("path").join(__dirname, "../src/database/migrations")), [
    "0001_create_ai_schema.sql",
    "0002_create_ai_domain_tables.sql",
    "0003_create_queue_jobs.sql",
    "0004_create_ingest_tables.sql",
    "0005_create_pipeline_states.sql",
    "0006_create_user_read_models.sql",
    "0007_create_company_context_drafts.sql",
    "0008_create_saas_access_control.sql",
    "0009_multi_tenant_lifecycle.sql",
    "0010_multi_tenant_operability.sql",
    "0011_scope_unique_keys.sql",
    "0012_persistent_auth_accounts.sql",
    "0013_company_scope_primary_key.sql",
    "0014_company_context_upload_requests.sql",
    "0015_process_settings.sql",
    "0016_management_identities.sql",
  ]);
});
