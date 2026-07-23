const config = require("../config/global_config");
const { validateEnvironment } = require("../config/environment");
const { createPool } = require("./pool");
const { withTransaction } = require("./transaction");

const MUTATION_PATTERN = /\b(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|comment|copy|refresh)\b/i;

function assertReadOnlyQuery(sql) {
  const normalized = String(sql || "").trim().replace(/^\/\/.*\n/gm, "");
  if (!/^(select|with)\b/i.test(normalized) || MUTATION_PATTERN.test(normalized)) {
    throw new Error("Source database only permits read-only SELECT queries");
  }
}

function createSourceDatabase(options = {}) {
  const env = validateEnvironment(options.env || process.env);
  const db = config.get("/database");
  const pool = options.pool || createPool({
    connectionString: options.connectionString || env.SOURCE_DATABASE_URL,
    max: db.sourcePoolMax, connectionTimeoutMs: db.connectionTimeoutMs,
    idleTimeoutMs: db.idleTimeoutMs, ssl: db.ssl,
    applicationName: "egi-media-ai-source-readonly",
  });
  return {
    pool,
    async query(sql, values = []) { assertReadOnlyQuery(sql); return pool.query(sql, values); },
    async transaction(work) {
      return withTransaction(pool, async (client) => {
        const readOnlyClient = { query: (sql, values = []) => { assertReadOnlyQuery(sql); return client.query(sql, values); } };
        return work(readOnlyClient);
      }, { readOnly: true });
    },
    async healthCheck() { return (await this.query("SELECT 1 AS ok")).rows[0].ok === 1; },
    async close() { await pool.end(); },
  };
}

module.exports = { createSourceDatabase, assertReadOnlyQuery };
