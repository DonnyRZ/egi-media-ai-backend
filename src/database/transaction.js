const VALID_ISOLATION_LEVELS = new Set(["SERIALIZABLE", "REPEATABLE READ", "READ COMMITTED"]);

async function withTransaction(pool, work, { readOnly = false, isolationLevel = "READ COMMITTED" } = {}) {
  if (!pool?.connect) throw new Error("A PostgreSQL pool with connect() is required");
  if (typeof work !== "function") throw new Error("Transaction work must be a function");
  if (!VALID_ISOLATION_LEVELS.has(isolationLevel)) throw new Error("Unsupported PostgreSQL isolation level");

  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}${readOnly ? " READ ONLY" : ""}`);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (rollbackError) { error.rollbackError = rollbackError; }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction, VALID_ISOLATION_LEVELS };
