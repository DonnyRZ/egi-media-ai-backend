const { randomUUID } = require("node:crypto");
const { permissionsForRole, isRole } = require("./rbac");
class MembershipNotFoundError extends Error { constructor(message = "Membership was not found") { super(message); this.code = "FORBIDDEN"; this.statusCode = 403; } }
class InMemoryMembershipStore {
  constructor({ memberships = [], now = Date.now } = {}) { this.memberships = new Map(); this.users = new Map(); this.now = now; for (const membership of memberships) this.upsert(membership); }
  upsert(input) { if (!input?.userId || !input.tenantId || !isRole(input.role)) throw new TypeError("A membership requires user, tenant, and valid role"); const key = `${input.userId}:${input.tenantId}:${input.companyId || "*"}`; const value = { membershipId: input.membershipId || randomUUID(), userId: input.userId, tenantId: input.tenantId, companyId: input.companyId || null, role: input.role, status: input.status || "active", version: input.version || 1, updatedAt: new Date(this.now()).toISOString() }; this.memberships.set(key, value); return { ...value }; }
  async resolve({ userId, tenantId, companyId = null, actorType = "human" }) { const exact = companyId ? this._find(userId, tenantId, companyId) : null; const tenant = this._find(userId, tenantId, null); const membership = exact || tenant; if (!membership || membership.status !== "active") throw new MembershipNotFoundError(); return { ...membership, actorType, permissions: [...permissionsForRole(membership.role)] }; }
  async list({ tenantId, companyId = undefined, page = 1, limit = 50 }) { const values = [...this.memberships.values()].filter((item) => item.tenantId === tenantId && (companyId === undefined || item.companyId === companyId)); const start = (page - 1) * limit; return { items: values.slice(start, start + limit).map((item) => this._withUser(item)), page, limit, total: values.length }; }
  async get({ membershipId, tenantId, companyId = undefined }) {
    const item = [...this.memberships.values()].find((candidate) => candidate.membershipId === membershipId && candidate.tenantId === tenantId && (companyId === undefined || candidate.companyId === companyId));
    return item ? this._withUser(item) : null;
  }
  async listForUser({ userId }) { return [...this.memberships.values()].filter((item) => item.userId === userId && item.status === "active").map((item) => this._withUser(item)); }
  async invite({ userId, email, fullName, tenantId, companyId = null, role, idempotencyKey, status }) {
    if (!userId && !email) throw new TypeError("userId or email is required");
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : null;
    const resolvedUserId = userId || `user:${normalizedEmail}`;
    const normalizedCompanyId = companyId || null;
    const existing = [...this.memberships.values()].find((item) =>
      item.userId === resolvedUserId && item.tenantId === tenantId && item.companyId === normalizedCompanyId,
    );
    const nextStatus = status === "active" || existing?.status === "active" ? "active" : "invited";
    const currentUser = this.users.get(resolvedUserId);
    this.users.set(resolvedUserId, {
      userId: resolvedUserId,
      email: normalizedEmail || currentUser?.email || email,
      fullName: fullName || currentUser?.fullName || null,
      status: nextStatus === "active" || currentUser?.status === "active" ? "active" : nextStatus,
    });
    const membership = this.upsert({
      ...(existing || {}),
      userId: resolvedUserId,
      tenantId,
      companyId: normalizedCompanyId,
      role,
      status: nextStatus,
      version: existing ? existing.version + 1 : 1,
    });
    return {
      membership: this._withUser(membership),
      reused: Boolean(existing),
      idempotencyKey,
    };
  }
  _withUser(item) {
    const user = this.users.get(item.userId);
    return { ...item, email: user?.email || null, fullName: user?.fullName || null, permissions: [...permissionsForRole(item.role)] };
  }
  async activateByUser({ userId }) { const activated = []; for (const [key, membership] of this.memberships.entries()) if (membership.userId === userId && membership.status === "invited") { const next = { ...membership, status: "active", version: membership.version + 1, updatedAt: new Date(this.now()).toISOString() }; this.memberships.set(key, next); activated.push({ ...next, permissions: [...permissionsForRole(next.role)] }); } return activated; }
  async update({ membershipId, tenantId, role, companyId, status, expectedVersion }) { const key = [...this.memberships.keys()].find((item) => this.memberships.get(item).membershipId === membershipId && this.memberships.get(item).tenantId === tenantId); const current = key ? this.memberships.get(key) : null; if (!current) throw new MembershipNotFoundError(); if (current.version !== expectedVersion) return { conflict: { expectedVersion, actualVersion: current.version } }; this.memberships.delete(key); return { membership: this.upsert({ ...current, role: role || current.role, companyId: companyId === undefined ? current.companyId : companyId, status: status || current.status, version: current.version + 1 }), reused: false }; }
  async revoke({ membershipId, tenantId, expectedVersion }) { return this.update({ membershipId, tenantId, expectedVersion, status: "revoked" }); }
  _find(userId, tenantId, companyId) { return [...this.memberships.values()].find((item) => item.userId === userId && item.tenantId === tenantId && item.companyId === companyId); }
}
class PostgresMembershipStore {
  constructor({ db } = {}) { if (!db?.query) throw new TypeError("PostgresMembershipStore requires db"); this.db = db; }
  async resolve({ userId, tenantId, companyId = null, actorType = "human" }) { const result = await this.db.query(`SELECT m.id AS membership_id,m.user_id,m.tenant_id,m.company_id,m.role,m.status,m.version FROM ai.memberships m WHERE m.user_id=$1 AND m.tenant_id=$2 AND m.status='active' AND (m.company_id=$3 OR (m.company_id IS NULL AND $3 IS NOT NULL) OR (m.company_id IS NULL AND $3 IS NULL)) ORDER BY (m.company_id IS NULL) ASC LIMIT 1`, [userId, tenantId, companyId]); const row = result.rows[0]; if (!row) throw new MembershipNotFoundError(); return { membershipId: row.membership_id, userId: row.user_id, tenantId: row.tenant_id, companyId: row.company_id, role: row.role, status: row.status, version: row.version, actorType, permissions: [...permissionsForRole(row.role)] }; }
  async list({ tenantId, companyId = undefined, page = 1, limit = 50 }) { const values = [tenantId]; const filters = ["m.tenant_id=$1"]; if (companyId !== undefined) { values.push(companyId); filters.push(`m.company_id=$${values.length}`); } values.push(limit, (page - 1) * limit); const result = await this.db.query(`SELECT m.id AS membership_id,m.user_id,m.tenant_id,m.company_id,m.role,m.status,m.version,u.email,u.full_name FROM ai.memberships m LEFT JOIN ai.users u ON u.id=m.user_id WHERE ${filters.join(" AND ")} ORDER BY m.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values); return { items: result.rows.map(mapMembershipRow), page, limit, total: result.rowCount }; }
  async get({ membershipId, tenantId, companyId = undefined }) { const values = [membershipId, tenantId]; const companyFilter = companyId === undefined ? "" : " AND m.company_id=$3"; if (companyId !== undefined) values.push(companyId); const result = await this.db.query(`SELECT m.id AS membership_id,m.user_id,m.tenant_id,m.company_id,m.role,m.status,m.version,u.email,u.full_name FROM ai.memberships m LEFT JOIN ai.users u ON u.id=m.user_id WHERE m.id=$1 AND m.tenant_id=$2${companyFilter} LIMIT 1`, values); const row = result.rows[0]; return row ? mapMembershipRow(row) : null; }
  async listForUser({ userId }) { const result = await this.db.query("SELECT m.id AS membership_id,m.user_id,m.tenant_id,m.company_id,m.role,m.status,m.version,u.email,u.full_name FROM ai.memberships m LEFT JOIN ai.users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.status='active' ORDER BY m.created_at ASC", [userId]); return result.rows.map(mapMembershipRow); }
  async invite({ userId, email, fullName, tenantId, companyId = null, role, status }) {
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : null;
    const resolvedUserId = userId || `user:${String(normalizedEmail || "").toLowerCase()}`;
    const existing = await this.db.query(
      "SELECT id,status FROM ai.memberships WHERE user_id=$1 AND tenant_id=$2 AND company_id IS NOT DISTINCT FROM $3 LIMIT 1",
      [resolvedUserId, tenantId, companyId || null],
    );
    const nextStatus = status === "active" || existing.rows[0]?.status === "active" ? "active" : "invited";
    await this.db.query(`INSERT INTO ai.users (id,email,full_name,status) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO UPDATE SET full_name=COALESCE(EXCLUDED.full_name,ai.users.full_name), status=CASE WHEN ai.users.status='active' OR EXCLUDED.status='active' THEN 'active' ELSE EXCLUDED.status END, updated_at=now()`, [resolvedUserId, normalizedEmail || `${resolvedUserId}@invalid.local`, fullName || null, nextStatus]);
    const membershipId = `membership:${tenantId}:${resolvedUserId}:${companyId || "tenant"}`;
    const result = await this.db.query(`INSERT INTO ai.memberships (id,user_id,tenant_id,company_id,role,status) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id,tenant_id,company_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,version=ai.memberships.version+1,updated_at=now() RETURNING id AS membership_id,user_id,tenant_id,company_id,role,status,version`, [membershipId, resolvedUserId, tenantId, companyId || null, role, nextStatus]);
    const row = result.rows[0];
    return { membership: { ...mapMembershipRow(row), email: normalizedEmail, fullName: fullName || null }, reused: existing.rowCount > 0 };
  }
  async activateByUser({ userId }) { const result = await this.db.query("UPDATE ai.memberships SET status='active',version=version+1,updated_at=now() WHERE user_id=$1 AND status='invited' RETURNING id AS membership_id,user_id,tenant_id,company_id,role,status,version", [userId]); return result.rows.map((row) => ({ membershipId: row.membership_id, userId: row.user_id, tenantId: row.tenant_id, companyId: row.company_id, role: row.role, status: row.status, version: row.version, permissions: [...permissionsForRole(row.role)] })); }
  async update({ membershipId, tenantId, role, companyId, status, expectedVersion }) { const result = await this.db.query(`UPDATE ai.memberships SET role=COALESCE($3,role),company_id=COALESCE($4,company_id),status=COALESCE($5,status),version=version+1,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND version=$6 RETURNING id AS membership_id,user_id,tenant_id,company_id,role,status,version`, [membershipId, tenantId, role || null, companyId === undefined ? null : companyId, status || null, expectedVersion]); if (!result.rowCount) { const current = await this.db.query("SELECT version FROM ai.memberships WHERE id=$1 AND tenant_id=$2", [membershipId, tenantId]); if (!current.rowCount) throw new MembershipNotFoundError(); return { conflict: { expectedVersion, actualVersion: current.rows[0].version } }; } const row = result.rows[0]; return { membership: { membershipId: row.membership_id, userId: row.user_id, tenantId: row.tenant_id, companyId: row.company_id, role: row.role, status: row.status, version: row.version, permissions: [...permissionsForRole(row.role)] }, reused: false }; }
  async revoke({ membershipId, tenantId, expectedVersion }) { return this.update({ membershipId, tenantId, expectedVersion, status: "revoked" }); }
}
// Tenant owners and tenant administrators are tenant-scoped operators. When
// their initial membership is tied to one company (as it is during platform
// provisioning), they must still be able to switch to another active company
// created in the same tenant. Keep the explicit company membership preferred;
// only fall back to an operator membership when no exact scope exists.
const inMemoryResolve = InMemoryMembershipStore.prototype.resolve;
InMemoryMembershipStore.prototype.resolve = async function resolveWithTenantOperatorFallback(args) {
  try {
    return await inMemoryResolve.call(this, args);
  } catch (error) {
    if (!(error instanceof MembershipNotFoundError) || !args?.companyId) throw error;
    const fallback = [...this.memberships.values()].find((item) =>
      item.userId === args.userId && item.tenantId === args.tenantId && item.status === "active" &&
      (item.role === "tenant_owner" || item.role === "tenant_admin"),
    );
    if (!fallback) throw error;
    return { ...fallback, companyId: null, actorType: args.actorType || "human", permissions: [...permissionsForRole(fallback.role)] };
  }
};

const postgresResolve = PostgresMembershipStore.prototype.resolve;
PostgresMembershipStore.prototype.resolve = async function resolveWithTenantOperatorFallback(args) {
  try {
    return await postgresResolve.call(this, args);
  } catch (error) {
    if (!(error instanceof MembershipNotFoundError) || !args?.companyId) throw error;
    const result = await this.db.query(
      `SELECT id AS membership_id,user_id,tenant_id,company_id,role,status,version
       FROM ai.memberships
       WHERE user_id=$1 AND tenant_id=$2 AND status='active'
         AND role IN ('tenant_owner','tenant_admin')
       ORDER BY (company_id IS NULL) DESC, created_at ASC
       LIMIT 1`,
      [args.userId, args.tenantId],
    );
    const row = result.rows[0];
    if (!row) throw error;
    return { membershipId: row.membership_id, userId: row.user_id, tenantId: row.tenant_id, companyId: null, role: row.role, status: row.status, version: row.version, actorType: args.actorType || "human", permissions: [...permissionsForRole(row.role)] };
  }
};

function mapMembershipRow(row) {
  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    companyId: row.company_id,
    role: row.role,
    status: row.status,
    version: row.version,
    email: row.email || null,
    fullName: row.full_name || null,
    permissions: [...permissionsForRole(row.role)],
  };
}

module.exports = { MembershipNotFoundError, InMemoryMembershipStore, PostgresMembershipStore };
