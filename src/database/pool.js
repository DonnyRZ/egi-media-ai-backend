const { Pool } = require("pg");

function createPool({ connectionString, max, connectionTimeoutMs, idleTimeoutMs, ssl, applicationName }) {
  if (!connectionString) throw new Error(`${applicationName} database URL is required`);
  return new Pool({
    connectionString, max, connectionTimeoutMillis: connectionTimeoutMs,
    idleTimeoutMillis: idleTimeoutMs,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    application_name: applicationName,
  });
}

module.exports = { createPool };
