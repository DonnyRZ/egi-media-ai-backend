const DATABASE_OWNERSHIP = Object.freeze({
  source: Object.freeze({
    databaseEnv: "SOURCE_DATABASE_URL",
    schema: "public",
    access: "read-only",
    owner: "egi-media-backend",
    tables: Object.freeze(["articles", "user_profiles"]),
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
    ]),
  }),
});

module.exports = { DATABASE_OWNERSHIP };
