CREATE TABLE IF NOT EXISTS ai.queue_jobs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  company_id text NOT NULL,
  queue_name text NOT NULL,
  job_type text NOT NULL,
  idempotency_key text NOT NULL,
  payload_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('queued','running','retrying','succeeded','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  last_error_code text,
  last_error_message text,
  dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, queue_name, idempotency_key)
);
CREATE INDEX IF NOT EXISTS queue_jobs_claim_idx ON ai.queue_jobs (queue_name, status, available_at, created_at);
CREATE INDEX IF NOT EXISTS queue_jobs_dead_letter_idx ON ai.queue_jobs (tenant_id, company_id, status, dead_lettered_at DESC);
