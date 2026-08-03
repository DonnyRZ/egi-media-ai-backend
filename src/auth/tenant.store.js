const { randomUUID } = require("node:crypto");

const TENANT_STATUSES = Object.freeze(["pending", "active", "suspended", "archived"]);
const TENANT_LIFECYCLE_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["active", "archived"]),
  active: Object.freeze(["suspended"]),
  suspended: Object.freeze(["active", "archived"]),
  archived: Object.freeze(["active"]),
});

class TenantLifecycleError extends Error {
  constructor(message, code = "TENANT_STATUS_TRANSITION_INVALID", statusCode = 409) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function validateTenantStatus(status) {
  if (!TENANT_STATUSES.includes(status)) throw new TenantLifecycleError("Tenant status is invalid", "TENANT_STATUS_INVALID", 400);
}

function validateTenantTransition(currentStatus, nextStatus) {
  validateTenantStatus(currentStatus);
  validateTenantStatus(nextStatus);
  if (currentStatus === nextStatus) return;
  if (!TENANT_LIFECYCLE_TRANSITIONS[currentStatus]?.includes(nextStatus)) {
    throw new TenantLifecycleError(`Tenant cannot move from ${currentStatus} to ${nextStatus}`);
  }
}

class InMemoryTenantStore {
  constructor() { this.tenants = new Map(); }
  async get({ tenantId }) { return this.tenants.get(tenantId) ? { ...this.tenants.get(tenantId) } : null; }
  async list({ page = 1, limit = 50 } = {}) { const items = [...this.tenants.values()]; const start = (page - 1) * limit; return { items: items.slice(start, start + limit), page, limit, total: items.length }; }
  async create({ tenantId, name, legalName = null, timezone = "UTC", defaultLocale = "id", status = "pending", metadata = {} }) {
    validateTenantStatus(status);
    const id = tenantId || randomUUID();
    if (this.tenants.has(id)) return { tenant: this.tenants.get(id), reused: true };
    const now = new Date().toISOString();
    const tenant = { tenantId: id, name, legalName, status, timezone, defaultLocale, metadata, createdAt: now, updatedAt: now };
    this.tenants.set(id, tenant);
    return { tenant, reused: false };
  }
  async update({ tenantId, ...changes }) {
    const current = this.tenants.get(tenantId);
    if (!current) throw Object.assign(new Error("Tenant was not found"), { code: "NOT_FOUND", statusCode: 404 });
    if (changes.status !== undefined) validateTenantTransition(current.status, changes.status);
    const next = { ...current, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)), updatedAt: new Date().toISOString() };
    this.tenants.set(tenantId, next);
    return { tenant: next, previousStatus: current.status };
  }
}
class PostgresTenantStore { constructor({ db } = {}) { if (!db?.query) throw new TypeError("PostgresTenantStore requires db"); this.db = db; } async get({ tenantId }) { const result = await this.db.query("SELECT id,name,legal_name,status,timezone,default_locale,metadata_jsonb,created_at,updated_at FROM ai.tenants WHERE id=$1", [tenantId]); return result.rows[0] ? serialize(result.rows[0]) : null; } async list({ page = 1, limit = 50 } = {}) {
    const offset = (page - 1) * limit;
    const [result, countResult] = await Promise.all([
      this.db.query("SELECT id,name,legal_name,status,timezone,default_locale,metadata_jsonb,created_at,updated_at FROM ai.tenants ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]),
      this.db.query("SELECT COUNT(*)::int AS total FROM ai.tenants"),
    ]);
    return { items: result.rows.map(serialize), page, limit, total: countResult.rows[0]?.total ?? result.rowCount };
  } async create({ tenantId, name, legalName = null, timezone = "UTC", defaultLocale = "id", status = "pending", metadata = {} }) { validateTenantStatus(status); const id = tenantId || randomUUID(); const result = await this.db.query("INSERT INTO ai.tenants (id,name,legal_name,status,timezone,default_locale,metadata_jsonb) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,legal_name=EXCLUDED.legal_name,timezone=EXCLUDED.timezone,default_locale=EXCLUDED.default_locale,metadata_jsonb=EXCLUDED.metadata_jsonb,updated_at=now() RETURNING id,name,legal_name,status,timezone,default_locale,metadata_jsonb,created_at,updated_at", [id, name, legalName, status, timezone, defaultLocale, JSON.stringify(metadata)]); return { tenant: serialize(result.rows[0]), reused: false }; } async update({ tenantId, ...changes }) { const current = await this.get({ tenantId }); if (!current) throw Object.assign(new Error("Tenant was not found"), { code: "NOT_FOUND", statusCode: 404 }); if (changes.status !== undefined) validateTenantTransition(current.status, changes.status); const allowed = { name: changes.name, legal_name: changes.legalName, status: changes.status, timezone: changes.timezone, default_locale: changes.defaultLocale, metadata_jsonb: changes.metadata ? JSON.stringify(changes.metadata) : undefined }; const set = Object.entries(allowed).filter(([, value]) => value !== undefined).map(([column], index) => `${column}=$${index + 2}`).join(","); const values = Object.entries(allowed).filter(([, value]) => value !== undefined).map(([, value]) => value); if (!set) throw Object.assign(new Error("No tenant changes supplied"), { code: "VALIDATION_ERROR", statusCode: 400 }); const result = await this.db.query(`UPDATE ai.tenants SET ${set},updated_at=now() WHERE id=$1 RETURNING id,name,legal_name,status,timezone,default_locale,metadata_jsonb,created_at,updated_at`, [tenantId, ...values]); if (!result.rowCount) throw Object.assign(new Error("Tenant was not found"), { code: "NOT_FOUND", statusCode: 404 }); return { tenant: serialize(result.rows[0]), previousStatus: current.status }; } }
function serialize(row) { return { tenantId: row.id, name: row.name, legalName: row.legal_name || null, status: row.status, timezone: row.timezone || "UTC", defaultLocale: row.default_locale || "id", metadata: row.metadata_jsonb || {}, createdAt: row.created_at, updatedAt: row.updated_at }; }
module.exports = { TENANT_STATUSES, TENANT_LIFECYCLE_TRANSITIONS, TenantLifecycleError, validateTenantStatus, validateTenantTransition, InMemoryTenantStore, PostgresTenantStore };
