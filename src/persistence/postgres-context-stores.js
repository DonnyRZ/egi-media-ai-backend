const { randomUUID } = require("crypto");
const { normalizeContextFieldsForRead } = require("../ai/tasks/t01-company-context-draft/schema");
const { evaluateContextCompleteness } = require("../company-context/completeness");

class PostgresCompanyContextDraftStore {
  constructor({ db, uuid = randomUUID } = {}) { this.db = db; this.uuid = uuid; }
  async create({ tenantId = "unknown", companyId, result, sourceFingerprints, provenance }) {
    const id = this.uuid(); const now = new Date().toISOString(); const review = { submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, note: null };
    const row = await this.db.query("INSERT INTO ai.company_context_drafts (id,tenant_id,company_id,status,revision,result_jsonb,source_fingerprints_jsonb,provenance_jsonb,review_jsonb,created_at,updated_at) VALUES ($1,$2,$3,'draft',1,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$8) RETURNING *", [id, tenantId, companyId, JSON.stringify(result), JSON.stringify(sourceFingerprints), JSON.stringify(provenance), JSON.stringify(review), now]);
    return mapDraft(row.rows[0]);
  }
  async get(draftId) { const row = await this.db.query("SELECT * FROM ai.company_context_drafts WHERE id=$1 LIMIT 1", [draftId]); return row.rows[0] ? mapDraft(row.rows[0]) : null; }
  async update(draftId, updater) { const current = await this.get(draftId); if (!current) return null; const next = updater(structuredClone(current)); const now = new Date().toISOString(); const row = await this.db.query("UPDATE ai.company_context_drafts SET status=$1,revision=$2,result_jsonb=$3::jsonb,source_fingerprints_jsonb=$4::jsonb,provenance_jsonb=$5::jsonb,review_jsonb=$6::jsonb,updated_at=$7 WHERE id=$8 AND revision=$9 RETURNING *", [next.status, current.revision + 1, JSON.stringify(next.result), JSON.stringify(next.sourceFingerprints), JSON.stringify(next.provenance), JSON.stringify(next.review), now, draftId, current.revision]); return row.rows[0] ? mapDraft(row.rows[0]) : null; }
  async listByCompany(companyId, tenantId = null) { const rows = tenantId ? await this.db.query("SELECT * FROM ai.company_context_drafts WHERE tenant_id=$1 AND company_id=$2 ORDER BY updated_at DESC", [tenantId, companyId]) : await this.db.query("SELECT * FROM ai.company_context_drafts WHERE company_id=$1 ORDER BY updated_at DESC", [companyId]); return rows.rows.map(mapDraft); }
  async list() { const rows = await this.db.query("SELECT * FROM ai.company_context_drafts ORDER BY updated_at DESC"); return rows.rows.map(mapDraft); }
}

class PostgresEffectiveCompanyContextStore {
  constructor({ db, uuid = randomUUID } = {}) { this.db = db; this.uuid = uuid; }
  async getEffective(companyId, tenantId = null) { const row = tenantId ? await this.db.query("SELECT * FROM ai.company_contexts WHERE tenant_id=$1 AND company_id=$2 AND status='effective' LIMIT 1", [tenantId, companyId]) : await this.db.query("SELECT * FROM ai.company_contexts WHERE company_id=$1 AND status='effective' LIMIT 1", [companyId]); return row.rows[0] ? mapContext(row.rows[0]) : null; }
  async getVersion(companyId, version, tenantId = null) { const row = tenantId ? await this.db.query("SELECT * FROM ai.company_contexts WHERE tenant_id=$1 AND company_id=$2 AND version=$3 LIMIT 1", [tenantId, companyId, version]) : await this.db.query("SELECT * FROM ai.company_contexts WHERE company_id=$1 AND version=$2 LIMIT 1", [companyId, version]); return row.rows[0] ? mapContext(row.rows[0]) : null; }
  async listByCompany({ tenantId, companyId, page = 1, limit = 100 } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 100));
    const offset = (safePage - 1) * safeLimit;
    const [rows, count] = await Promise.all([
      this.db.query("SELECT * FROM ai.company_contexts WHERE tenant_id=$1 AND company_id=$2 ORDER BY version DESC LIMIT $3 OFFSET $4", [tenantId, companyId, safeLimit, offset]),
      this.db.query("SELECT COUNT(*)::int AS total FROM ai.company_contexts WHERE tenant_id=$1 AND company_id=$2", [tenantId, companyId]),
    ]);
    return { items: rows.rows.map(mapContext), page: safePage, limit: safeLimit, total: count.rows[0]?.total ?? rows.rowCount };
  }
  async activate({ tenantId = "unknown", companyId, fields, fieldSources = [], missingFields = [], fieldReview = null, completeness = null, source, actorId, draftId = null, changeReason = null, expectedNextVersion }) {
    const current = await this.db.query("SELECT COALESCE(MAX(version),0)::int AS version FROM ai.company_contexts WHERE tenant_id=$1 AND company_id=$2", [tenantId, companyId]); const nextVersion = current.rows[0].version + 1;
    if (expectedNextVersion !== undefined && expectedNextVersion !== nextVersion) return { conflict: { expectedNextVersion, actualNextVersion: nextVersion } };
    await this.db.query("UPDATE ai.company_contexts SET status='archived',updated_at=now() WHERE tenant_id=$1 AND company_id=$2 AND status='effective'", [tenantId, companyId]);
    const id = this.uuid(); const now = new Date().toISOString(); const content = { fields, fieldSources, missingFields, fieldReview, completeness, source, draftId, changeReason, updatedBy: actorId };
    const row = await this.db.query("INSERT INTO ai.company_contexts (id,tenant_id,company_id,version,content_jsonb,source,status,updated_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'effective',$7,$8,$8) RETURNING *", [id, tenantId, companyId, nextVersion, JSON.stringify(content), source, actorId, now]);
    return { context: mapContext(row.rows[0]) };
  }
  async clearEffective({ tenantId = null, companyId }) {
    const current = await this.getEffective(companyId, tenantId);
    if (!current) return { cleared: false, context: null };
    await this.db.query(
      "UPDATE ai.company_contexts SET status='archived', updated_at=now() WHERE tenant_id=$1 AND company_id=$2 AND status='effective'",
      [tenantId ?? current.tenantId, companyId],
    );
    return { cleared: true, context: { ...current, status: "archived" } };
  }
}

function mapDraft(row) { return { draftId: row.id, tenantId: row.tenant_id, companyId: row.company_id, status: row.status, isEffective: false, revision: row.revision, result: row.result_jsonb, sourceFingerprints: row.source_fingerprints_jsonb, provenance: row.provenance_jsonb, review: row.review_jsonb, createdAt: date(row.created_at), updatedAt: date(row.updated_at) }; }
function mapContext(row) {
  const content = row.content_jsonb || {};
  return {
    contextId: row.id,
    tenantId: row.tenant_id,
    companyId: row.company_id,
    version: row.version,
    status: row.status,
    source: row.source,
    draftId: content.draftId || null,
    fields: normalizeContextFieldsForRead(content.fields || {}),
    fieldSources: content.fieldSources || [],
    fieldReview: content.fieldReview || null,
    missingFields: content.missingFields || [],
    completeness: content.completeness?.rule_version === "review-v2"
      ? content.completeness
      : evaluateContextCompleteness(content.fields || {}, content.fieldReview || null, { legacyEffective: true }),
    changeReason: content.changeReason || null,
    updatedBy: row.updated_by,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}
function date(value) { return value?.toISOString?.() || value; }
module.exports = { PostgresCompanyContextDraftStore, PostgresEffectiveCompanyContextStore };
