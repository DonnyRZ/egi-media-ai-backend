CREATE TABLE IF NOT EXISTS ai.pipeline_states (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  company_id text NOT NULL,
  current_task_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','retrying','succeeded','dead_letter')),
  version integer NOT NULL CHECK (version >= 1),
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_states_scope_idx ON ai.pipeline_states (tenant_id, company_id, status, updated_at DESC);
