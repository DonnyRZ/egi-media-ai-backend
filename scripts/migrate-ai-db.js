const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { validateEnvironment } = require("../src/config/environment");

const MIGRATION_LOCK_NAME = "egi-media-ai-schema-migrations";
const MIGRATION_TABLE = "ai.schema_migrations";

function migrationFiles(migrationsDir) {
  return fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".rollback.sql"))
    .sort();
}

async function migrate({ client: providedClient, connectionString, env: providedEnv = process.env } = {}) {
  const env = validateEnvironment(providedEnv);
  const ownsClient = !providedClient;
  const client = providedClient || new Client({ connectionString: connectionString || env.AI_DATABASE_URL });
  const migrationsDir = path.join(__dirname, "../src/database/migrations");
  const files = migrationFiles(migrationsDir);

  if (ownsClient) await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_NAME]);
    await client.query("CREATE SCHEMA IF NOT EXISTS ai");
    await client.query(`CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      version varchar(255) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query("SELECT version FROM ai.schema_migrations");
    const appliedVersions = new Set(applied.rows.map((row) => row.version));
    for (const file of files) {
      if (appliedVersions.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO ai.schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Applied AI migration: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_NAME]);
    if (ownsClient) await client.end();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error(`AI migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { migrate, migrationFiles, MIGRATION_LOCK_NAME, MIGRATION_TABLE };
