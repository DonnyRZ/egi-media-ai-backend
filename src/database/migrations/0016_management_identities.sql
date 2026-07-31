-- Management identity persisted per company context version (Luna draft).
CREATE TABLE IF NOT EXISTS ai.management_identities (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  context_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  identity_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, context_version)
);

CREATE INDEX IF NOT EXISTS management_identities_company_idx
  ON ai.management_identities (tenant_id, company_id, context_version DESC);
