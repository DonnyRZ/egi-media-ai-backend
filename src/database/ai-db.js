const config = require("../config/global_config");
const { validateEnvironment } = require("../config/environment");
const { createPool } = require("./pool");
const { withTransaction } = require("./transaction");

function createAiDatabase(options = {}) {
  const env = validateEnvironment(options.env || process.env);
  const db = config.get("/database");
  const pool = options.pool || createPool({
    connectionString: options.connectionString || env.AI_DATABASE_URL,
    max: db.aiPoolMax, connectionTimeoutMs: db.connectionTimeoutMs,
    idleTimeoutMs: db.idleTimeoutMs, ssl: db.ssl,
    applicationName: "egi-media-ai-write",
  });
  return {
    pool,
    query(sql, values = []) { return pool.query(sql, values); },
    transaction(work, options = {}) { return withTransaction(pool, work, options); },
    async healthCheck() { return (await pool.query("SELECT 1 AS ok")).rows[0].ok === 1; },
    async close() { await pool.end(); },
  };
}

module.exports = { createAiDatabase };
