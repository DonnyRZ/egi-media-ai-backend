const { randomUUID } = require("node:crypto");
class InMemoryAccessAuditStore {
  constructor({ now = Date.now } = {}) { this.events = []; this.now = now; }
  async record(input) {
    const event = { id: input.id || randomUUID(), actorId: input.actorId || null, actorType: input.actorType || "unknown", tenantId: input.tenantId || null, companyId: input.companyId || null, action: input.action, outcome: input.outcome, requestId: input.requestId || null, metadata: input.metadata || {}, createdAt: new Date(this.now()).toISOString() };
    this.events.push(event);
    return { ...event };
  }
  async list({ tenantId, companyId, actorId, action, outcome, limit = 100 } = {}) {
    return this.events
      .filter((item) => (!tenantId || item.tenantId === tenantId)
        && (!companyId || item.companyId === companyId)
        && (!actorId || item.actorId === actorId)
        && (!action || item.action === action)
        && (!outcome || item.outcome === outcome))
      .slice(-limit)
      .reverse();
  }
}
class PostgresAccessAuditStore {
  constructor({ db } = {}) { if (!db?.query) throw new TypeError("PostgresAccessAuditStore requires db"); this.db = db; }
  async record(input) { const result = await this.db.query("INSERT INTO ai.access_audit_events (id,actor_id,actor_type,tenant_id,company_id,action,outcome,request_id,metadata_jsonb) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id,created_at", [input.id || randomUUID(), input.actorId || null, input.actorType || "unknown", input.tenantId || null, input.companyId || null, input.action, input.outcome, input.requestId || null, JSON.stringify(input.metadata || {})]); return result.rows[0]; }
  async list({ tenantId = null, companyId = null, actorId = null, action = null, outcome = null, limit = 100 } = {}) {
    const clauses = [];
    const values = [];
    for (const [column, value] of [["tenant_id", tenantId], ["company_id", companyId], ["actor_id", actorId], ["action", action], ["outcome", outcome]]) {
      if (!value) continue;
      values.push(value);
      clauses.push(`${column}=$${values.length}`);
    }
    values.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.db.query(`SELECT id,actor_id,actor_type,tenant_id,company_id,action,outcome,request_id,metadata_jsonb,created_at FROM ai.access_audit_events ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
    return result.rows.map((row) => ({ id: row.id, actorId: row.actor_id, actorType: row.actor_type, tenantId: row.tenant_id, companyId: row.company_id, action: row.action, outcome: row.outcome, requestId: row.request_id, metadata: row.metadata_jsonb || {}, createdAt: row.created_at }));
  }
}
module.exports = { InMemoryAccessAuditStore, PostgresAccessAuditStore };
