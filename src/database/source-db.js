const config = require("../config/global_config");
const { validateEnvironment } = require("../config/environment");
const { createPool } = require("./pool");
const { withTransaction } = require("./transaction");
const { createLogger } = require("../observability");

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
  const logger = options.logger || createLogger({ service: "egi-media-ai-backend.source-database" });
  return {
    pool,
    async query(sql, values = []) { assertReadOnlyQuery(sql); try { return await pool.query(sql, values); } catch (error) { logger.error("database_query_failed", { database: "source", operation: operationName(sql), parameterCount: values.length, error }); throw error; } },
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

function operationName(sql) { return String(sql || "").trim().split(/\s+/).slice(0, 2).join(" ").toUpperCase(); }

module.exports = { createSourceDatabase, assertReadOnlyQuery };
