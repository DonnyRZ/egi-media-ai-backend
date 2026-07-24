CREATE TABLE IF NOT EXISTS ai.company_context_upload_requests (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  company_id text NOT NULL,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','completed','failed')),
  response_jsonb jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, actor_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS company_context_upload_requests_scope_idx ON ai.company_context_upload_requests (tenant_id, company_id, created_at DESC);
