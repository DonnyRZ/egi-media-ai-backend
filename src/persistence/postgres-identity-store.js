"use strict";

const { randomUUID } = require("crypto");

class PostgresManagementIdentityStore {
  constructor({ db, uuid = randomUUID } = {}) {
    this.db = db;
    this.uuid = uuid;
  }

  async get({ tenantId = "unknown", companyId, contextVersion }) {
    const row = await this.db.query(
      `SELECT * FROM ai.management_identities
       WHERE tenant_id=$1 AND company_id=$2 AND context_version=$3
       LIMIT 1`,
      [tenantId || "unknown", companyId, contextVersion],
    );
    return row.rows[0] ? mapRow(row.rows[0]) : null;
  }

  async upsert({
    tenantId = "unknown",
    companyId,
    contextVersion,
    status,
    identity = null,
    provenance = null,
    errorMessage = null,
  }) {
    const id = this.uuid();
    const now = new Date().toISOString();
    const row = await this.db.query(
      `INSERT INTO ai.management_identities
         (id, tenant_id, company_id, context_version, status, identity_jsonb, provenance_jsonb, error_message, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$9)
       ON CONFLICT (tenant_id, company_id, context_version) DO UPDATE SET
         status = EXCLUDED.status,
         identity_jsonb = COALESCE(EXCLUDED.identity_jsonb, ai.management_identities.identity_jsonb),
         provenance_jsonb = COALESCE(EXCLUDED.provenance_jsonb, ai.management_identities.provenance_jsonb),
         error_message = EXCLUDED.error_message,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        id,
        tenantId || "unknown",
        companyId,
        contextVersion,
        status,
        JSON.stringify(identity || {}),
        JSON.stringify(provenance || {}),
        errorMessage,
        now,
      ],
    );
    return mapRow(row.rows[0]);
  }
}

function mapRow(row) {
  const identity = row.identity_jsonb && Object.keys(row.identity_jsonb).length
    ? row.identity_jsonb
    : null;
  return {
    identityId: row.id,
    tenantId: row.tenant_id,
    companyId: row.company_id,
    contextVersion: row.context_version,
    status: row.status,
    identity,
    provenance: row.provenance_jsonb || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
  };
}

module.exports = { PostgresManagementIdentityStore };
