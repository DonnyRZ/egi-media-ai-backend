const { randomUUID } = require("node:crypto");

class InMemoryPlatformOperatorStore {
  constructor({ operators = [] } = {}) { this.operators = new Map(operators.map((operator) => [operator.userId, { ...operator }])); }
  async resolve({ userId }) { const operator = this.operators.get(userId); return operator?.status === "active" ? { ...operator } : null; }
  async upsert({ userId, role = "platform_superadmin", status = "active" }) { const operator = { operatorId: randomUUID(), userId, role, status }; this.operators.set(userId, operator); return { ...operator }; }
}

class PostgresPlatformOperatorStore {
  constructor({ db } = {}) { if (!db?.query) throw new TypeError("PostgresPlatformOperatorStore requires db"); this.db = db; }
  async resolve({ userId }) { const result = await this.db.query("SELECT id,user_id,role,status FROM ai.platform_operators WHERE user_id=$1 AND status='active'", [userId]); const row = result.rows[0]; return row ? { operatorId: row.id, userId: row.user_id, role: row.role, status: row.status } : null; }
  async upsert({ userId, role = "platform_superadmin", status = "active" }) { const id = `platform:${userId}`; const result = await this.db.query("INSERT INTO ai.platform_operators (id,user_id,role,status) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,updated_at=now() RETURNING id,user_id,role,status", [id, userId, role, status]); const row = result.rows[0]; return { operatorId: row.id, userId: row.user_id, role: row.role, status: row.status }; }
}

module.exports = { InMemoryPlatformOperatorStore, PostgresPlatformOperatorStore };
