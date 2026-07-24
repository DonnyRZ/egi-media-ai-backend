const { randomUUID } = require("crypto");

class InMemoryCompanyContextUploadRequestStore {
  constructor({ uuid = randomUUID } = {}) { this.uuid = uuid; this.items = new Map(); }
  key({ tenantId, companyId, actorId, idempotencyKey }) { return `${tenantId}|${companyId}|${actorId}|${idempotencyKey}`; }
  get(input) { return this.items.get(this.key(input)) || null; }
  createPending(input) { const key = this.key(input); const existing = this.items.get(key); if (existing) return existing; const value = { id: this.uuid(), ...input, status: "pending", response: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; this.items.set(key, value); return value; }
  complete(input, response) { const item = this.items.get(this.key(input)); if (!item) return null; item.status = "completed"; item.response = structuredClone(response); item.updatedAt = new Date().toISOString(); return item; }
  fail(input, error) { const item = this.items.get(this.key(input)); if (!item) return null; item.status = "failed"; item.errorCode = error?.code || "UPLOAD_FAILED"; item.updatedAt = new Date().toISOString(); return item; }
}

class PostgresCompanyContextUploadRequestStore {
  constructor({ db, uuid = randomUUID } = {}) { this.db = db; this.uuid = uuid; }
  async get({ tenantId, companyId, actorId, idempotencyKey }) { const result = await this.db.query("SELECT * FROM ai.company_context_upload_requests WHERE tenant_id=$1 AND company_id=$2 AND actor_id=$3 AND idempotency_key=$4 LIMIT 1", [tenantId, companyId, actorId, idempotencyKey]); return result.rows[0] ? map(result.rows[0]) : null; }
  async createPending({ tenantId, companyId, actorId, idempotencyKey, requestHash }) { const result = await this.db.query("INSERT INTO ai.company_context_upload_requests (id,tenant_id,company_id,actor_id,idempotency_key,request_hash,status) VALUES ($1,$2,$3,$4,$5,$6,'pending') ON CONFLICT (tenant_id,company_id,actor_id,idempotency_key) DO NOTHING RETURNING *", [this.uuid(), tenantId, companyId, actorId, idempotencyKey, requestHash]); return result.rows[0] ? map(result.rows[0]) : this.get({ tenantId, companyId, actorId, idempotencyKey }); }
  async complete({ tenantId, companyId, actorId, idempotencyKey }, response) { const result = await this.db.query("UPDATE ai.company_context_upload_requests SET status='completed',response_jsonb=$1::jsonb,updated_at=now() WHERE tenant_id=$2 AND company_id=$3 AND actor_id=$4 AND idempotency_key=$5 RETURNING *", [JSON.stringify(response), tenantId, companyId, actorId, idempotencyKey]); return result.rows[0] ? map(result.rows[0]) : null; }
  async fail({ tenantId, companyId, actorId, idempotencyKey }, error) { const result = await this.db.query("UPDATE ai.company_context_upload_requests SET status='failed',error_code=$1,updated_at=now() WHERE tenant_id=$2 AND company_id=$3 AND actor_id=$4 AND idempotency_key=$5 RETURNING *", [error?.code || "UPLOAD_FAILED", tenantId, companyId, actorId, idempotencyKey]); return result.rows[0] ? map(result.rows[0]) : null; }
}

function map(row) { return { id: row.id, tenantId: row.tenant_id, companyId: row.company_id, actorId: row.actor_id, idempotencyKey: row.idempotency_key, requestHash: row.request_hash, status: row.status, response: row.response_jsonb || null, errorCode: row.error_code || null, createdAt: row.created_at?.toISOString?.() || row.created_at, updatedAt: row.updated_at?.toISOString?.() || row.updated_at }; }
module.exports = { InMemoryCompanyContextUploadRequestStore, PostgresCompanyContextUploadRequestStore };
