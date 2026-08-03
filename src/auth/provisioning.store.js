const { randomUUID } = require("node:crypto");

const TENANT_STATUSES = Object.freeze(["pending", "active", "suspended", "archived"]);
const COMPANY_STATUSES = TENANT_STATUSES;

class ProvisioningError extends Error {
  constructor(message, code = "VALIDATION_ERROR", statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

class InMemoryCompanyStore {
  constructor({ companies = [] } = {}) { this.companies = new Map(companies.map((item) => [key(item.tenantId, item.companyId), normalizeCompany(item)])); }
  async get({ tenantId, companyId }) { const value = this.companies.get(key(tenantId, companyId)); return value ? { ...value } : null; }
  async list({ tenantId, page = 1, limit = 50 } = {}) { const items = [...this.companies.values()].filter((item) => item.tenantId === tenantId).sort((left, right) => new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf()); return paginate(items, page, limit); }
  async create(input) { const value = normalizeCompany({ ...input, companyId: input.companyId || randomUUID(), status: input.status || "pending" }); const scope = key(value.tenantId, value.companyId); if (this.companies.has(scope)) return { company: this.companies.get(scope), reused: true }; this.companies.set(scope, value); return { company: { ...value }, reused: false }; }
  async update({ tenantId, companyId, ...changes }) { const current = this.companies.get(key(tenantId, companyId)); if (!current) throw new ProvisioningError("Company was not found", "NOT_FOUND", 404); if (changes.status && !COMPANY_STATUSES.includes(changes.status)) throw new ProvisioningError("Company status is invalid"); const next = normalizeCompany({ ...current, ...changes, tenantId, companyId, updatedAt: new Date().toISOString() }); this.companies.set(key(tenantId, companyId), next); return { company: { ...next } }; }
  async listEligible({ effectiveContextStore } = {}) { return [...this.companies.values()].filter((item) => item.status === "active" && item.tenantId && item.companyId && (!effectiveContextStore || effectiveContextStore.getEffective(item.companyId, item.tenantId))).map((item) => ({ tenantId: item.tenantId, companyId: item.companyId, hasEffectiveContext: true })); }
}

class InMemoryTenantProvisioningStore {
  constructor({ tenantStore, companyStore } = {}) { this.tenantStore = tenantStore; this.companyStore = companyStore; }
  async update({ tenantId, ...changes }) { const current = [...(this.tenantStore.tenants?.values?.() || [])].find((item) => item.tenantId === tenantId); if (!current) throw new ProvisioningError("Tenant was not found", "NOT_FOUND", 404); if (changes.status && !TENANT_STATUSES.includes(changes.status)) throw new ProvisioningError("Tenant status is invalid"); const next = { ...current, ...changes, updatedAt: new Date().toISOString() }; this.tenantStore.tenants.set(tenantId, next); return { tenant: next }; }
}

class PostgresCompanyStore {
  constructor({ db } = {}) { if (!db?.query) throw new TypeError("PostgresCompanyStore requires db"); this.db = db; }
  async get({ tenantId, companyId }) { const result = await this.db.query("SELECT id,tenant_id,name,legal_name,status,timezone,locale,metadata_jsonb,created_at,updated_at FROM ai.companies WHERE tenant_id=$1 AND id=$2", [tenantId, companyId]); return result.rows[0] ? mapCompany(result.rows[0]) : null; }
  async list({ tenantId, page = 1, limit = 50 } = {}) { const result = await this.db.query("SELECT id,tenant_id,name,legal_name,status,timezone,locale,metadata_jsonb,created_at,updated_at FROM ai.companies WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3", [tenantId, limit, (page - 1) * limit]); return { items: result.rows.map(mapCompany), page, limit, total: result.rowCount }; }
  async create({ tenantId, companyId, name, legalName = null, timezone = null, locale = null, status = "pending", metadata = {} }) { const id = companyId || randomUUID(); const result = await this.db.query("INSERT INTO ai.companies (id,tenant_id,name,legal_name,status,timezone,locale,metadata_jsonb) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (tenant_id,id) DO UPDATE SET name=EXCLUDED.name,legal_name=EXCLUDED.legal_name,timezone=EXCLUDED.timezone,locale=EXCLUDED.locale,metadata_jsonb=EXCLUDED.metadata_jsonb,updated_at=now() RETURNING id,tenant_id,name,legal_name,status,timezone,locale,metadata_jsonb,created_at,updated_at", [id, tenantId, name, legalName, status, timezone, locale, JSON.stringify(metadata)]); return { company: mapCompany(result.rows[0]), reused: result.rowCount === 0 }; }
  async update({ tenantId, companyId, ...changes }) { const fields = { name: changes.name, legal_name: changes.legalName, status: changes.status, timezone: changes.timezone, locale: changes.locale, metadata_jsonb: changes.metadata ? JSON.stringify(changes.metadata) : undefined }; const entries = Object.entries(fields).filter(([, value]) => value !== undefined); if (!entries.length) throw new ProvisioningError("No company changes supplied"); const set = entries.map(([column], index) => `${column}=$${index + 3}`).join(","); const result = await this.db.query(`UPDATE ai.companies SET ${set},updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,tenant_id,name,legal_name,status,timezone,locale,metadata_jsonb,created_at,updated_at`, [tenantId, companyId, ...entries.map(([, value]) => value)]); if (!result.rowCount) throw new ProvisioningError("Company was not found", "NOT_FOUND", 404); return { company: mapCompany(result.rows[0]) }; }
  async listEligible() { const result = await this.db.query("SELECT c.tenant_id,c.id AS company_id FROM ai.companies c JOIN ai.company_contexts cc ON cc.tenant_id=c.tenant_id AND cc.company_id=c.id AND cc.status='effective' WHERE c.status='active'"); return result.rows.map((row) => ({ tenantId: row.tenant_id, companyId: row.company_id, hasEffectiveContext: true })); }
}

function key(tenantId, companyId) { return `${tenantId}:${companyId}`; }
function normalizeCompany(input) { if (!input?.tenantId || !input?.companyId || !input?.name) throw new ProvisioningError("Tenant, company ID, and company name are required"); if (!TENANT_STATUSES.includes(input.status || "pending")) throw new ProvisioningError("Company status is invalid"); return { companyId: input.companyId, tenantId: input.tenantId, name: String(input.name).trim(), legalName: input.legalName || null, status: input.status || "pending", timezone: input.timezone || null, locale: input.locale || null, metadata: input.metadata || {}, createdAt: input.createdAt || new Date().toISOString(), updatedAt: input.updatedAt || new Date().toISOString() }; }
function paginate(items, page, limit) { const safePage = Math.max(1, Number(page) || 1); const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50)); return { items: items.slice((safePage - 1) * safeLimit, safePage * safeLimit), page: safePage, limit: safeLimit, total: items.length }; }

function mapCompany(row) { return { companyId: row.id, tenantId: row.tenant_id, name: row.name, legalName: row.legal_name || null, status: row.status, timezone: row.timezone || null, locale: row.locale || null, metadata: row.metadata_jsonb || {}, createdAt: row.created_at, updatedAt: row.updated_at }; }

module.exports = { TENANT_STATUSES, COMPANY_STATUSES, ProvisioningError, InMemoryCompanyStore, PostgresCompanyStore, InMemoryTenantProvisioningStore, normalizeCompany, paginate };
