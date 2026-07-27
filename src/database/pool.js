const { Pool } = require("pg");

function createPool({
  connectionString,
  max,
  connectionTimeoutMs,
  idleTimeoutMs,
  queryTimeoutMs,
  statementTimeoutMs,
  ssl,
  applicationName,
}) {
  if (!connectionString) throw new Error(`${applicationName} database URL is required`);
  return new Pool({
    connectionString, max, connectionTimeoutMillis: connectionTimeoutMs,
    idleTimeoutMillis: idleTimeoutMs,
    query_timeout: queryTimeoutMs,
    statement_timeout: statementTimeoutMs,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    application_name: applicationName,
  });
}

module.exports = { createPool };
