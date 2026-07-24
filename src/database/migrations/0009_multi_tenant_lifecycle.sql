-- M02-M06: lifecycle and provisioning metadata. This migration never creates a
-- customer tenant for the platform bootstrap account.
UPDATE ai.tenants SET status = 'archived' WHERE status = 'deleted';

ALTER TABLE ai.tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE ai.tenants ADD CONSTRAINT tenants_status_check CHECK (status IN ('pending','active','suspended','archived'));
ALTER TABLE ai.tenants ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE ai.tenants ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';
ALTER TABLE ai.tenants ADD COLUMN IF NOT EXISTS default_locale text NOT NULL DEFAULT 'id';
ALTER TABLE ai.tenants ADD COLUMN IF NOT EXISTS metadata_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ai.companies DROP CONSTRAINT IF EXISTS companies_status_check;
ALTER TABLE ai.companies ADD CONSTRAINT companies_status_check CHECK (status IN ('pending','active','suspended','archived'));
ALTER TABLE ai.companies ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE ai.companies ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE ai.companies ADD COLUMN IF NOT EXISTS locale text;
ALTER TABLE ai.companies ADD COLUMN IF NOT EXISTS metadata_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS companies_tenant_status_idx ON ai.companies (tenant_id, status, created_at DESC);

ALTER TABLE ai.memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE ai.memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('platform_superadmin','tenant_owner','tenant_admin','company_admin','executive','executive_viewer','analyst','reviewer','viewer','ai_worker'));
CREATE INDEX IF NOT EXISTS tenants_status_idx ON ai.tenants (status, created_at DESC);
