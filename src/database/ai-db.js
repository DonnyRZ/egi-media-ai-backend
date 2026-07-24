const config = require("../config/global_config");
const { validateEnvironment } = require("../config/environment");
const { createPool } = require("./pool");
const { withTransaction } = require("./transaction");
const { createLogger } = require("../observability");

function createAiDatabase(options = {}) {
  const env = validateEnvironment(options.env || process.env);
  const db = config.get("/database");
  const pool = options.pool || createPool({
    connectionString: options.connectionString || env.AI_DATABASE_URL,
    max: db.aiPoolMax, connectionTimeoutMs: db.connectionTimeoutMs,
    idleTimeoutMs: db.idleTimeoutMs, ssl: db.ssl,
    applicationName: "egi-media-ai-write",
  });
  const logger = options.logger || createLogger({ service: "egi-media-ai-backend.database" });
  return {
    pool,
    async query(sql, values = []) { try { return await pool.query(sql, values); } catch (error) { logger.error("database_query_failed", { database: "ai", operation: operationName(sql), parameterCount: values.length, error }); throw error; } },
    transaction(work, options = {}) { return withTransaction(pool, work, options); },
    async healthCheck() { return (await pool.query("SELECT 1 AS ok")).rows[0].ok === 1; },
    async close() { await pool.end(); },
  };
}

function operationName(sql) { return String(sql || "").trim().split(/\s+/).slice(0, 2).join(" ").toUpperCase(); }

module.exports = { createAiDatabase };
