const DATABASE_OWNERSHIP = Object.freeze({
  source: Object.freeze({
    databaseEnv: "SOURCE_DATABASE_URL",
    schema: "public",
    access: "read-only",
    owner: "egi-media-backend",
    tables: Object.freeze(["articles", "user_profiles"]),
  }),
  crawl: Object.freeze({
    databaseEnv: "CRAWL_DATABASE_URL",
    schema: "public",
    access: "read-only",
    owner: "egi-media-crawl",
    tables: Object.freeze(["articles"]),
  }),
  ai: Object.freeze({
    databaseEnv: "AI_DATABASE_URL",
    schema: "ai",
    access: "read-write",
    owner: "egi-media-ai-backend",
    tables: Object.freeze([
      "schema_migrations",
      "issues",
      "issue_articles",
      "analyses",
      "priorities",
      "alerts",
      "reports",
      "audit_events",
      "crawl_industry_decisions",
      "crawl_industry_score_cursors",
    ]),
  }),
});

module.exports = { DATABASE_OWNERSHIP };
