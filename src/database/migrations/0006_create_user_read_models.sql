CREATE TABLE IF NOT EXISTS ai.saved_issues (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  company_id text NOT NULL,
  actor_id text NOT NULL,
  issue_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, actor_id, issue_id)
);
CREATE INDEX IF NOT EXISTS saved_issues_scope_idx ON ai.saved_issues (tenant_id, company_id, actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai.feedback (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  company_id text NOT NULL,
  actor_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('issue','report','analysis')),
  target_id text NOT NULL,
  feedback_type text NOT NULL CHECK (feedback_type IN ('helpful','not_helpful','incorrect','missing_context','other')),
  comment text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, actor_id, idempotency_key)
);

ALTER TABLE ai.alert_events ADD COLUMN IF NOT EXISTS read_at timestamptz;
CREATE INDEX IF NOT EXISTS alert_events_inbox_idx ON ai.alert_events (tenant_id, company_id, created_at DESC);
