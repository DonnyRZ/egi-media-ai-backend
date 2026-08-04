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

function normalizeTenantSearch(search) {
  return typeof search === "string" && search.trim() ? search.trim().toLowerCase() : null;
}

function tenantMatches(tenant, { status = null, search = null } = {}) {
  if (status && tenant.status !== status) return false;
  if (!search) return true;
  const haystack = [tenant.tenantId, tenant.name, tenant.legalName].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(search);
}

function tenantStatusCounts(items) {
  const counts = { all: items.length, pending: 0, active: 0, suspended: 0, archived: 0 };
  for (const item of items) if (counts[item.status] !== undefined) counts[item.status] += 1;
  return counts;
}

function normalizeTenantIds(tenantIds) {
  return [...new Set((Array.isArray(tenantIds) ? tenantIds : []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

class InMemoryTenantStore {
  constructor() { this.tenants = new Map(); }
  async get({ tenantId }) { return this.tenants.get(tenantId) ? { ...this.tenants.get(tenantId) } : null; }
  async list({ page = 1, limit = 50, status = null, search = null } = {}) {
    const normalizedSearch = normalizeTenantSearch(search);
    const allItems = [...this.tenants.values()].sort((left, right) => new Date(right.updatedAt).valueOf() - new Date(left.updatedAt).valueOf());
    const matchingItems = allItems.filter((item) => tenantMatches(item, { search: normalizedSearch }));
    const items = matchingItems.filter((item) => tenantMatches(item, { status, search: normalizedSearch }));
    const start = (page - 1) * limit;
    return { items: items.slice(start, start + limit), page, limit, total: items.length, counts: tenantStatusCounts(matchingItems) };
  }
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
  async bulkUpdate({ tenantIds = [], status, filterStatus = null, search = null } = {}) {
    validateTenantStatus(status);
    const normalizedIds = normalizeTenantIds(tenantIds);
    const normalizedSearch = normalizeTenantSearch(search);
    const candidates = normalizedIds.length
      ? normalizedIds.map((tenantId) => this.tenants.get(tenantId)).filter(Boolean)
      : [...this.tenants.values()].filter((item) => tenantMatches(item, { status: filterStatus, search: normalizedSearch }));
    if (!candidates.length) throw Object.assign(new Error("No matching workspaces were found"), { code: "NOT_FOUND", statusCode: 404 });
    for (const current of candidates) validateTenantTransition(current.status, status);
    const now = new Date().toISOString();
    const tenants = candidates.map((current) => {
      const next = { ...current, status, updatedAt: now };
      this.tenants.set(current.tenantId, next);
      return next;
    });
    return { tenants, previousStatuses: candidates.map((item) => ({ tenantId: item.tenantId, status: item.status })) };
  }
}
class PostgresTenantStore { constructor({ db } = {}) { if (!db?.query) throw new TypeError("PostgresTenantStore requires db"); this.db = db; } async get({ tenantId }) { const result = await this.db.query("SELECT id,name,legal_name,status,timezone,default_locale,metadata_jsonb,created_at,updated_at FROM ai.tenants WHERE id=$1", [tenantId]); return result.rows[0] ? serialize(result.rows[0]) : null; } async list({ page = 1, limit = 50, status = null, search = null } = {}) {
    const offset = (page - 1) * limit;
    const searchTerm = normalizeTenantSearch(search);
    validateOptionalTenantStatus(status);
    const searchValues = [];
    const searchClauses = [];
    if (searchTerm) { searchValues.push(`%${searchTerm}%`); searchClauses.push(`(name ILIKE $${searchValues.length} OR id ILIKE $${searchValues.length} OR COALESCE(legal_name, '') ILIKE $${searchValues.length})`); }
    const listValues = [...searchValues];
    const listClauses = [...searchClauses];
    if (status) { listValues.push(status); listClauses.push(`status=$${listValues.length}`); }
    listValues.push(limit, offset);
    const where = (listClauses.length ? ` WHERE ${listClauses.join(" AND ")}` : "");
    const searchWhere = (searchClauses.length ? ` WHERE ${searchClauses.join(" AND ")}` : "");
    const [result, countResult] = await Promise.all([
      this.db.query(`SELECT id,name,legal_name,status,timezone,default_locale,metadata_jsonb,created_at,updated_at FROM ai.tenants${where} ORDER BY updated_at DESC, created_at DESC LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`, listValues),
      this.db.query(`SELECT status,COUNT(*)::int AS count FROM ai.tenants${searchWhere} GROUP BY status`, searchValues),
    ]);
    const counts = { all: 0, pending: 0, active: 0, suspended: 0, archived: 0 };
    for (const row of countResult.rows) { counts[row.status] = row.count; counts.all += row.count; }
    return { items: result.rows.map(serialize), page, limit, total: status ? counts[status] || 0 : counts.all, counts };
  } async create({ tenantId, name, legalName = null, timezone = "UTC", defaultLocale = "id", status = "pending", metadata = {} }) { validateTenantStatus(status); const id = tenantId || randomUUID(); const result = await this.db.query("INSERT INTO ai.tenants (id,name,legal_name,status,timezone,default_locale,metadata_jsonb) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,legal_name=EXCLUDED.legal_name,timezone=EXCLUDED.timezone,default_locale=EXCLUDED.default_locale,metadata_jsonb=EXCLUDED.metadata_jsonb,updated_at=now() RETURNING id,name,legal_name,status,timezone,default_locale,metadata_jsonb,created_at,updated_at", [id, name, legalName, status, timezone, defaultLocale, JSON.stringify(metadata)]); return { tenant: serialize(result.rows[0]), reused: false }; } async update({ tenantId, ...changes }) { const current = await this.get({ tenantId }); if (!current) throw Object.assign(new Error("Tenant was not found"), { code: "NOT_FOUND", statusCode: 404 }); if (changes.status !== undefined) validateTenantTransition(current.status, changes.status); const allowed = { name: changes.name, legal_name: changes.legalName, status: changes.status, timezone: changes.timezone, default_locale: changes.defaultLocale, metadata_jsonb: changes.metadata ? JSON.stringify(changes.metadata) : undefined }; const set = Object.entries(allowed).filter(([, value]) => value !== undefined).map(([column], index) => `${column}=$${index + 2}`).join(","); const values = Object.entries(allowed).filter(([, value]) => value !== undefined).map(([, value]) => value); if (!set) throw Object.assign(new Error("No tenant changes supplied"), { code: "VALIDATION_ERROR", statusCode: 400 }); const result = await this.db.query(`UPDATE ai.tenants SET ${set},updated_at=now() WHERE id=$1 RETURNING id,name,legal_name,status,timezone,default_locale,metadata_jsonb,created_at,updated_at`, [tenantId, ...values]); if (!result.rowCount) throw Object.assign(new Error("Tenant was not found"), { code: "NOT_FOUND", statusCode: 404 }); return { tenant: serialize(result.rows[0]), previousStatus: current.status }; } async bulkUpdate({ tenantIds = [], status, filterStatus = null, search = null } = {}) {
    validateTenantStatus(status);
    validateOptionalTenantStatus(filterStatus);
    const ids = normalizeTenantIds(tenantIds);
    const run = async (tx) => {
      const values = [];
      const clauses = [];
      if (ids.length) { values.push(ids); clauses.push(`id = ANY($${values.length}::text[])`); }
      if (filterStatus) { values.push(filterStatus); clauses.push(`status=$${values.length}`); }
      const searchTerm = normalizeTenantSearch(search);
      if (searchTerm) { values.push(`%${searchTerm}%`); clauses.push(`(name ILIKE $${values.length} OR id ILIKE $${values.length} OR COALESCE(legal_name, '') ILIKE $${values.length})`); }
      const result = await tx.query(`SELECT id,name,legal_name,status,timezone,default_locale,metadata_jsonb,created_at,updated_at FROM ai.tenants WHERE ${clauses.join(" AND ")} FOR UPDATE`, values);
      if (!result.rowCount) throw Object.assign(new Error("No matching workspaces were found"), { code: "NOT_FOUND", statusCode: 404 });
      for (const row of result.rows) validateTenantTransition(row.status, status);
      const updated = await tx.query("UPDATE ai.tenants SET status=$1,updated_at=now() WHERE id = ANY($2::text[]) RETURNING id,name,legal_name,status,timezone,default_locale,metadata_jsonb,created_at,updated_at", [status, result.rows.map((row) => row.id)]);
      return { tenants: updated.rows.map(serialize), previousStatuses: result.rows.map((row) => ({ tenantId: row.id, status: row.status })) };
    };
    if (typeof this.db.transaction === "function") return this.db.transaction(run);
    return run(this.db);
  } }
function validateOptionalTenantStatus(status) { if (status !== null && status !== undefined) validateTenantStatus(status); }
function serialize(row) { return { tenantId: row.id, name: row.name, legalName: row.legal_name || null, status: row.status, timezone: row.timezone || "UTC", defaultLocale: row.default_locale || "id", metadata: row.metadata_jsonb || {}, createdAt: row.created_at, updatedAt: row.updated_at }; }
module.exports = { TENANT_STATUSES, TENANT_LIFECYCLE_TRANSITIONS, TenantLifecycleError, validateTenantStatus, validateTenantTransition, InMemoryTenantStore, PostgresTenantStore };
