const { Pool } = require("pg");
const { migrate } = require("../../scripts/migrate-ai-db");

function testDatabaseUrl() { return process.env.AI_TEST_DATABASE_URL || null; }
async function openTestDatabase() {
  const connectionString = testDatabaseUrl();
  if (!connectionString) return null;
  const pool = new Pool({ connectionString, max: 2 });
  const client = await pool.connect();
  try { await migrate({ client, env: { SOURCE_DATABASE_URL: connectionString, AI_DATABASE_URL: connectionString } }); }
  finally { client.release(); }
  return { pool, async close() { await pool.end(); }, async query(sql, values = []) { return pool.query(sql, values); } };
}
module.exports = { testDatabaseUrl, openTestDatabase };
