const { randomUUID } = require("crypto");

class PostgresStageRunStore {
  constructor({ db, task, uuid = randomUUID } = {}) { this.db = db; this.task = task; this.uuid = uuid; }
  async _find(predicate) {
    const result = await this.db.query("SELECT * FROM ai.stage_runs WHERE task=$1 ORDER BY created_at DESC", [this.task]);
    return result.rows.map((row) => row.payload_jsonb || {}).find(predicate) || null;
  }
  async _create(value, output) {
    const id = value.labelRunId || value.rationaleId || value.priorityReasonId || value.directBlurbId || this.uuid();
    await this.db.query("INSERT INTO ai.stage_runs (id,tenant_id,company_id,task,prompt_version,output_jsonb,payload_jsonb,validation_status,completed_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'validated',$8)", [id, value.tenantId || null, value.companyId || null, this.task, value.promptVersion, JSON.stringify(output || {}), JSON.stringify(value), value.createdAt || new Date().toISOString()]);
    return value;
  }
}

class PostgresRelevanceRationaleStore extends PostgresStageRunStore {
  constructor(options) { super({ ...options, task: "T03" }); }
  async get({ decisionId, promptVersion }) { return this._find((value) => value.decisionId === decisionId && value.promptVersion === promptVersion); }
  async create({ decisionId, companyId, promptVersion, rationale, provenance }) { const existing = await this.get({ decisionId, promptVersion }); if (existing) return existing; const value = { rationaleId: this.uuid(), decisionId, companyId, promptVersion, rationale, provenance, createdAt: new Date().toISOString() }; return this._create(value, { rationale }); }
}

class PostgresClaimLabelStore extends PostgresStageRunStore {
  constructor(options) { super({ ...options, task: "T08" }); }
  async get({ analysisId, promptVersion }) { return this._find((value) => value.analysisId === analysisId && value.promptVersion === promptVersion); }
  async create({ tenantId, companyId, analysisId, issueId, promptVersion, labels, provenance }) { const existing = await this.get({ analysisId, promptVersion }); if (existing) return existing; const value = { labelRunId: this.uuid(), tenantId, companyId, analysisId, issueId, promptVersion, labels, provenance, createdAt: new Date().toISOString() }; return this._create(value, { labels }); }
}

class PostgresPriorityReasonStore extends PostgresStageRunStore {
  constructor(options) { super({ ...options, task: "T10" }); }
  async get({ priorityDecisionId, promptVersion }) { return this._find((value) => value.priorityDecisionId === priorityDecisionId && value.promptVersion === promptVersion); }
  async create({ tenantId, companyId, issueId, analysisId, priorityDecisionId, promptVersion, reason, sourceClaimIds, provenance }) { const existing = await this.get({ priorityDecisionId, promptVersion }); if (existing) return existing; const value = { priorityReasonId: this.uuid(), tenantId, companyId, issueId, analysisId, priorityDecisionId, promptVersion, reason, sourceClaimIds, provenance, createdAt: new Date().toISOString() }; return this._create(value, { reason, sourceClaimIds }); }
}

class PostgresDirectAlertBlurbStore extends PostgresStageRunStore {
  constructor(options) { super({ ...options, task: "T12" }); }
  async get({ alertEventId, promptVersion }) { return this._find((value) => value.alertEventId === alertEventId && value.promptVersion === promptVersion); }
  async create({ tenantId, companyId, issueId, developmentId, alertEventId, promptVersion, newDevelopmentBlurb, shortImpactBlurb, sourceClaimIds, provenance }) { const existing = await this.get({ alertEventId, promptVersion }); if (existing) return existing; const value = { directBlurbId: this.uuid(), tenantId, companyId, issueId, developmentId, alertEventId, promptVersion, newDevelopmentBlurb, shortImpactBlurb, sourceClaimIds, provenance, createdAt: new Date().toISOString() }; return this._create(value, { newDevelopmentBlurb, shortImpactBlurb, sourceClaimIds }); }
}

module.exports = { PostgresRelevanceRationaleStore, PostgresClaimLabelStore, PostgresPriorityReasonStore, PostgresDirectAlertBlurbStore };
