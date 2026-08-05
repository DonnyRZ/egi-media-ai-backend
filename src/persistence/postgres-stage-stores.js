const { randomUUID } = require("crypto");
const { resolvePipelineId } = require("../pipeline/pipeline-trace");

class PostgresStageRunStore {
  constructor({ db, task, uuid = randomUUID } = {}) { this.db = db; this.task = task; this.uuid = uuid; }
  async _find(predicate) {
    const result = await this.db.query("SELECT * FROM ai.stage_runs WHERE task=$1 ORDER BY created_at DESC", [this.task]);
    return result.rows.map((row) => row.payload_jsonb || {}).find(predicate) || null;
  }
  async _create(value, output) {
    const id = value.labelRunId || value.rationaleId || value.priorityReasonId || value.directBlurbId || this.uuid();
    const pipelineRunId = resolvePipelineId(value);
    const provenance = value.provenance || {};
    const completedAt = value.createdAt || new Date().toISOString();
    const startedAt = value.startedAt || provenance.createdAt || null;
    const attempts = Number.isInteger(value.attempts) && value.attempts > 0 ? value.attempts : 1;
    await this.db.query(
      "INSERT INTO ai.stage_runs (id,pipeline_run_id,tenant_id,company_id,task,input_fingerprint,output_jsonb,validation_status,model,prompt_id,prompt_version,provider_request_id,attempts,started_at,completed_at,payload_jsonb) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'validated',$8,$9,$10,$11,$12,$13,$14,$15::jsonb)",
      [
        id,
        pipelineRunId,
        value.tenantId || null,
        value.companyId || null,
        this.task,
        value.inputFingerprint || null,
        JSON.stringify(output || {}),
        provenance.model || null,
        provenance.promptId || null,
        value.promptVersion || provenance.promptVersion || null,
        provenance.providerRequestId || null,
        attempts,
        startedAt,
        completedAt,
        JSON.stringify(value),
      ],
    );
    return value;
  }
}

class PostgresRelevanceRationaleStore extends PostgresStageRunStore {
  constructor(options) { super({ ...options, task: "T03" }); }
  async get({ decisionId, promptVersion }) { return this._find((value) => value.decisionId === decisionId && value.promptVersion === promptVersion); }
  async create({ tenantId = null, decisionId, companyId, promptVersion, rationale, provenance, pipelineId = null, inputFingerprint = null }) { const existing = await this.get({ decisionId, promptVersion }); if (existing) return existing; const value = { rationaleId: this.uuid(), tenantId, decisionId, companyId, promptVersion, rationale, provenance, pipelineId, inputFingerprint, createdAt: new Date().toISOString() }; return this._create(value, { rationale }); }
}

class PostgresClaimLabelStore extends PostgresStageRunStore {
  constructor(options) { super({ ...options, task: "T08" }); }
  async get({ analysisId, promptVersion }) { return this._find((value) => value.analysisId === analysisId && value.promptVersion === promptVersion); }
  async create({ tenantId, companyId, analysisId, issueId, promptVersion, labels, provenance, pipelineId = null, inputFingerprint = null }) { const existing = await this.get({ analysisId, promptVersion }); if (existing) return existing; const value = { labelRunId: this.uuid(), tenantId, companyId, analysisId, issueId, promptVersion, labels, provenance, pipelineId, inputFingerprint, createdAt: new Date().toISOString() }; return this._create(value, { labels }); }
}

class PostgresPriorityReasonStore extends PostgresStageRunStore {
  constructor(options) { super({ ...options, task: "T10" }); }
  async get({ priorityDecisionId, promptVersion }) { return this._find((value) => value.priorityDecisionId === priorityDecisionId && value.promptVersion === promptVersion); }
  async create({ tenantId, companyId, issueId, analysisId, priorityDecisionId, promptVersion, reason, sourceClaimIds, provenance, pipelineId = null, inputFingerprint = null }) { const existing = await this.get({ priorityDecisionId, promptVersion }); if (existing) return existing; const value = { priorityReasonId: this.uuid(), tenantId, companyId, issueId, analysisId, priorityDecisionId, promptVersion, reason, sourceClaimIds, provenance, pipelineId, inputFingerprint, createdAt: new Date().toISOString() }; return this._create(value, { reason, sourceClaimIds }); }
}

class PostgresDirectAlertBlurbStore extends PostgresStageRunStore {
  constructor(options) { super({ ...options, task: "T12" }); }
  async get({ alertEventId, promptVersion }) { return this._find((value) => value.alertEventId === alertEventId && value.promptVersion === promptVersion); }
  async listByAlertEventIds({ tenantId, companyId, alertEventIds, promptVersion }) {
    const ids = Array.isArray(alertEventIds) ? alertEventIds.filter((id) => typeof id === "string" && id) : [];
    if (!ids.length) return [];
    const result = await this.db.query(
      "SELECT payload_jsonb FROM ai.stage_runs WHERE task='T12' AND tenant_id=$1 AND company_id=$2 AND prompt_version=$3 AND payload_jsonb->>'alertEventId'=ANY($4::text[]) ORDER BY created_at DESC",
      [tenantId, companyId, promptVersion, ids],
    );
    return result.rows.map((row) => row.payload_jsonb || {});
  }
  async create({ tenantId, companyId, issueId, developmentId, alertEventId, promptVersion, newDevelopmentBlurb, shortImpactBlurb, sourceClaimIds, provenance, pipelineId = null, inputFingerprint = null }) { const existing = await this.get({ alertEventId, promptVersion }); if (existing) return existing; const value = { directBlurbId: this.uuid(), tenantId, companyId, issueId, developmentId, alertEventId, promptVersion, newDevelopmentBlurb, shortImpactBlurb, sourceClaimIds, provenance, pipelineId, inputFingerprint, createdAt: new Date().toISOString() }; return this._create(value, { newDevelopmentBlurb, shortImpactBlurb, sourceClaimIds }); }
}

module.exports = { PostgresRelevanceRationaleStore, PostgresClaimLabelStore, PostgresPriorityReasonStore, PostgresDirectAlertBlurbStore };
