-- Company identifiers are tenant-scoped business identifiers, not global identifiers.
-- Replace the legacy global primary key so the same company ID can exist in two tenants.
ALTER TABLE ai.memberships DROP CONSTRAINT IF EXISTS memberships_tenant_id_company_id_fkey;
ALTER TABLE ai.companies DROP CONSTRAINT IF EXISTS companies_pkey;
ALTER TABLE ai.companies ADD CONSTRAINT companies_pkey PRIMARY KEY (tenant_id, id);
ALTER TABLE ai.memberships
  ADD CONSTRAINT memberships_tenant_id_company_id_fkey
  FOREIGN KEY (tenant_id, company_id) REFERENCES ai.companies(tenant_id, id);
