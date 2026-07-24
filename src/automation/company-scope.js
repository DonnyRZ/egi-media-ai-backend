class InMemoryPipelineCompanyStore {
  constructor({ companies = [] } = {}) { this.companies = companies; }
  async listEligible() { return this.companies.filter((item) => item.tenantId && item.companyId && item.hasEffectiveContext !== false).map((item) => ({ ...item })); }
}

class PostgresPipelineCompanyStore {
  constructor({ db } = {}) { if (!db?.query) throw new TypeError("Postgres pipeline company store requires db"); this.db = db; }
  async listEligible() { const result = await this.db.query("SELECT c.tenant_id, c.id AS company_id FROM ai.companies c JOIN ai.company_contexts cc ON cc.company_id=c.id AND cc.tenant_id=c.tenant_id AND cc.status='effective' WHERE c.status='active'"); return result.rows.map((row) => ({ tenantId: row.tenant_id, companyId: row.company_id, hasEffectiveContext: true })); }
}

module.exports = { InMemoryPipelineCompanyStore, PostgresPipelineCompanyStore };
