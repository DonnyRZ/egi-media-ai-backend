CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE IF NOT EXISTS ai.schema_migrations (
  version varchar(255) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
