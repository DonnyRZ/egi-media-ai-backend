const { evaluateContextCompleteness } = require("../company-context/completeness");

class InMemoryPipelineCompanyStore {
  constructor({ companies = [] } = {}) { this.companies = companies; }
  async listEligible() {
    return this.companies
      .filter((item) => item.tenantId && item.companyId
        && item.hasEffectiveContext !== false
        && item.hasReadyManagementIdentity !== false)
      .map((item) => ({ ...item }));
  }
}

class PostgresPipelineCompanyStore {
  constructor({ db } = {}) { if (!db?.query) throw new TypeError("Postgres pipeline company store requires db"); this.db = db; }
  async listEligible() {
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
    `);
    return result.rows
      .filter((row) => evaluateContextCompleteness(row.content_jsonb?.fields || {}).complete)
      .map((row) => ({
      tenantId: row.tenant_id,
      companyId: row.company_id,
      hasEffectiveContext: true,
      hasReadyManagementIdentity: true,
      }));
  }
}

module.exports = { InMemoryPipelineCompanyStore, PostgresPipelineCompanyStore };
