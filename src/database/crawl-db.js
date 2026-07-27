"use strict";

const config = require("../config/global_config");
const { createPool } = require("./pool");
const { createLogger } = require("../observability");

const MUTATION_PATTERN = /\b(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|comment|copy|refresh)\b/i;

function assertCrawlReadOnlyQuery(sql) {
  const normalized = String(sql || "").trim().replace(/^--.*\n/gm, "");
  if (!/^(select|with)\b/i.test(normalized) || MUTATION_PATTERN.test(normalized)) {
    const error = new Error("Crawl database only permits read-only SELECT queries");
    error.code = "CRAWL_DATABASE_READ_ONLY";
    throw error;
  }
}

function createCrawlDatabase(options = {}) {
  const db = config.get("/database");
  const env = options.env || process.env;
  const connectionString = options.connectionString || env.CRAWL_DATABASE_URL;
  const queryTimeoutMs = options.queryTimeoutMs || db.crawlQueryTimeoutMs;
  const pool = options.pool || createPool({
    connectionString,
    max: db.crawlPoolMax,
    connectionTimeoutMs: db.crawlConnectionTimeoutMs,
    idleTimeoutMs: db.idleTimeoutMs,
    queryTimeoutMs,
    statementTimeoutMs: queryTimeoutMs,
    ssl: db.ssl,
    applicationName: "egi-media-ai-crawl-readonly",
  });
  const logger = options.logger || createLogger({ service: "egi-media-ai-backend.crawl-database" });

  return {
    pool,
    queryTimeoutMs,
    async query(sql, values = []) {
      assertCrawlReadOnlyQuery(sql);
      try {
        return await pool.query(sql, values);
      } catch (error) {
        logger.error("database_query_failed", {
          database: "crawl",
          operation: operationName(sql),
          parameterCount: values.length,
          error,
        });
        throw error;
      }
    },
    async healthCheck() {
      return (await this.query("SELECT 1 AS ok")).rows[0].ok === 1;
    },
    async close() {
      await pool.end();
    },
  };
}

function operationName(sql) {
  return String(sql || "").trim().split(/\s+/).slice(0, 2).join(" ").toUpperCase();
}

module.exports = { assertCrawlReadOnlyQuery, createCrawlDatabase };
