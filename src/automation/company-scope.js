const { evaluateContextCompleteness } = require("../company-context/completeness");
const { isEvalTenantId, parseCsvIds } = require("./worker-tenant-policy");

function scopeFilterFromEnv(env = process.env) {
  const allowEval = env.AI_ALLOW_EVAL_TENANTS === "true";
  const allowlist = parseCsvIds(env.AI_WORKER_TENANT_IDS)
    .filter((id) => allowEval || !isEvalTenantId(id));
  return { allowEval, allowlist };
}

function passesTenantScope(tenantId, { allowEval, allowlist }) {
  if (!allowEval && isEvalTenantId(tenantId)) return false;
  if (allowlist.length) return allowlist.includes(tenantId);
  return true;
}

class InMemoryPipelineCompanyStore {
  constructor({ companies = [] } = {}) { this.companies = companies; }
  async listEligible() {
    const scope = scopeFilterFromEnv();
    return this.companies
      .filter((item) => item.tenantId && item.companyId
        && item.hasEffectiveContext !== false
        && item.hasReadyManagementIdentity !== false
        && passesTenantScope(item.tenantId, scope))
      .map((item) => ({ ...item }));
  }
}

class PostgresPipelineCompanyStore {
  constructor({ db } = {}) { if (!db?.query) throw new TypeError("Postgres pipeline company store requires db"); this.db = db; }
  async listEligible() {
    const { allowEval, allowlist } = scopeFilterFromEnv();
    const values = [allowEval];
    let allowlistSql = "";
    if (allowlist.length) {
      values.push(allowlist);
      allowlistSql = ` AND c.tenant_id = ANY($${values.length}::text[])`;
    }
    const result = await this.db.query(`
      SELECT c.tenant_id, c.id AS company_id, cc.content_jsonb
      FROM ai.companies c
      JOIN ai.company_contexts cc
        ON cc.company_id = c.id AND cc.tenant_id = c.tenant_id AND cc.status = 'effective'
      JOIN ai.management_identities mi
        ON mi.tenant_id = c.tenant_id
        AND mi.company_id = c.id
        AND mi.context_version = cc.version
        AND mi.status = 'ready'
      WHERE c.status = 'active'
        AND ($1::boolean OR (c.tenant_id NOT LIKE 'eval-%' AND c.tenant_id NOT LIKE '%eval-tenant%'))
        ${allowlistSql}
    `, values);
    return result.rows
      .filter((row) => evaluateContextCompleteness(
        row.content_jsonb?.fields || {},
        row.content_jsonb?.fieldReview || null,
        { legacyEffective: !row.content_jsonb?.fieldReview },
      ).complete)
      .map((row) => ({
      tenantId: row.tenant_id,
      companyId: row.company_id,
      hasEffectiveContext: true,
      hasReadyManagementIdentity: true,
      }));
  }
}

module.exports = { InMemoryPipelineCompanyStore, PostgresPipelineCompanyStore };
