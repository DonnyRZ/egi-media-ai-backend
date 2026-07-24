-- M18: scope indexes and per-tenant AI usage accounting primitives.
CREATE INDEX IF NOT EXISTS issue_analyses_scope_idx ON ai.issue_analyses (tenant_id, company_id, issue_id, status);
CREATE INDEX IF NOT EXISTS issue_priorities_scope_idx ON ai.issue_priorities (tenant_id, company_id, issue_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS article_relevance_scope_idx ON ai.article_relevance (tenant_id, company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stage_runs_scope_idx ON ai.stage_runs (tenant_id, company_id, task, created_at DESC);
CREATE INDEX IF NOT EXISTS queue_jobs_scope_status_idx ON ai.queue_jobs (tenant_id, company_id, status, available_at);
CREATE INDEX IF NOT EXISTS pipeline_states_scope_idx ON ai.pipeline_states (tenant_id, company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS reports_scope_status_idx ON ai.reports (tenant_id, company_id, review_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS alert_preferences_scope_idx ON ai.alert_preferences (tenant_id, company_id, user_ref);

CREATE TABLE IF NOT EXISTS ai.tenant_ai_usage_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES ai.tenants(id),
  company_id text NOT NULL,
  task text NOT NULL,
  model text NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL,
  metadata_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_ai_usage_scope_idx ON ai.tenant_ai_usage_events (tenant_id, company_id, window_started_at DESC);

CREATE TABLE IF NOT EXISTS ai.tenant_rate_limit_windows (
  tenant_id text NOT NULL REFERENCES ai.tenants(id),
  window_key text NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  token_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, window_key)
);
