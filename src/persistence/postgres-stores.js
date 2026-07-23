const { randomUUID } = require("crypto");
const { PostgresRecordStore } = require("./postgres-record-store");

const json = (value) => JSON.stringify(value ?? {});
const payload = (row) => row.payload_jsonb || {};

class PostgresRelevanceDecisionStore extends PostgresRecordStore {
  constructor(options) { super({ ...options, table: "ai.article_relevance", mapRow: mapRelevance }); }
  async get({ articleId, companyId, contextVersion, inputFingerprint }) {
    const result = await this.db.query("SELECT * FROM ai.article_relevance WHERE company_id=$1 AND article_snapshot_id=$2 AND context_id=$3 AND payload_jsonb->>'inputFingerprint'=$4 LIMIT 1", [companyId, articleId, contextVersion, inputFingerprint]);
    return result.rows[0] ? mapRelevance(result.rows[0]) : null;
  }
  async getById(decisionId) { return this.findOne({ id: decisionId }); }
  async create({ articleId, companyId, contextVersion, inputFingerprint, source, output, provenance }) {
    const id = this.uuid(); const value = { decisionId:id, articleId, companyId, contextVersion, inputFingerprint, source, relevance:output.relevance, confidence:output.confidence, branch:output.relevance === "none" ? "stop" : "continue", provenance, createdAt:new Date().toISOString() };
    const result = await this.db.query("INSERT INTO ai.article_relevance (id,tenant_id,company_id,article_snapshot_id,context_id,relevance,confidence,payload_jsonb) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (company_id,article_snapshot_id,context_id) DO NOTHING RETURNING *", [id, source.tenantId || "unknown", companyId, articleId, contextVersion, output.relevance, output.confidence ?? null, json({...value, source, inputFingerprint})]);
    return result.rows[0] ? mapRelevance(result.rows[0]) : this.get({ articleId, companyId, contextVersion, inputFingerprint });
  }
}

class PostgresIssueMatchDecisionStore extends PostgresRecordStore {
  constructor(options) { super({ ...options, table: "ai.stage_runs", mapRow: payload }); }
  async get({ tenantId, companyId, relevanceDecisionId, promptVersion }) { const values = await this.list({tenantId, companyId}); return values.find((v) => v.task === "T04" && v.relevanceDecisionId === relevanceDecisionId && v.promptVersion === promptVersion) || null; }
  async getById(matchDecisionId) { return this.findOne({ id:matchDecisionId }); }
  async create({ tenantId, companyId, relevanceDecisionId, promptVersion, output, provenance }) { const id=this.uuid(); const value={matchDecisionId:id,tenantId,companyId,relevanceDecisionId,promptVersion,decision:output.decision,candidateIssueId:output.candidate_issue_id,reasonCode:output.reason_code,provenance,createdAt:new Date().toISOString(),task:"T04"}; await this.db.query("INSERT INTO ai.stage_runs (id,tenant_id,company_id,task,prompt_version,output_jsonb,payload_jsonb) VALUES ($1,$2,$3,'T04',$4,$5::jsonb,$6::jsonb)",[id,tenantId,companyId,promptVersion,json(output),json(value)]); return value; }
}

class PostgresIssueAnalysisStore extends PostgresRecordStore {
  constructor(options) { super({ ...options, table:"ai.issue_analyses", mapRow:mapAnalysis }); }
  async get({tenantId,companyId,issueId,inputFingerprint,promptVersion}) { const r=await this.db.query("SELECT * FROM ai.issue_analyses WHERE tenant_id=$1 AND company_id=$2 AND issue_id=$3 AND input_fingerprint=$4 AND prompt_version=$5 LIMIT 1",[tenantId,companyId,issueId,inputFingerprint,promptVersion]); return r.rows[0]?mapAnalysis(r.rows[0]):null; }
  async getById(id) { return this.findOne({id}); }
  async getCurrent({tenantId,companyId,issueId}) { const r=await this.db.query("SELECT * FROM ai.issue_analyses WHERE tenant_id=$1 AND company_id=$2 AND issue_id=$3 AND status='current' ORDER BY valid_at DESC NULLS LAST LIMIT 1",[tenantId,companyId,issueId]); return r.rows[0]?mapAnalysis(r.rows[0]):null; }
  async create(value) { const id=this.uuid(); await this.db.query("INSERT INTO ai.issue_analyses (id,tenant_id,company_id,issue_id,input_fingerprint,prompt_version,status,analysis_jsonb,evidence_jsonb,provenance_jsonb) VALUES ($1,$2,$3,$4,$5,$6,'validated',$7::jsonb,$8::jsonb,$9::jsonb)",[id,value.tenantId,value.companyId,value.issueId,value.inputFingerprint,value.promptVersion,json(value.analysis),json(value.evidence),json(value.provenance)]); return {analysisId:id,...value,status:"validated"}; }
}

class PostgresIssuePriorityStore extends PostgresRecordStore {
  constructor(options) { super({ ...options, table:"ai.issue_priorities", mapRow:mapPriority }); }
  async get({tenantId,companyId,issueId,analysisId}) { const r=await this.db.query("SELECT * FROM ai.issue_priorities WHERE tenant_id=$1 AND company_id=$2 AND issue_id=$3 AND analysis_id=$4 ORDER BY effective_at DESC LIMIT 1",[tenantId,companyId,issueId,analysisId]); return r.rows[0]?mapPriority(r.rows[0]):null; }
  async create(value) { const id=this.uuid(); await this.db.query("INSERT INTO ai.issue_priorities (id,tenant_id,company_id,issue_id,analysis_id,priority,provenance_jsonb,effective_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",[id,value.tenantId,value.companyId,value.issueId,value.analysisId,value.priority,json(value.provenance),value.effectiveAt||new Date().toISOString()]); return {priorityDecisionId:id,...value}; }
}
function mapRelevance(row) { return {...payload(row),decisionId:row.id,relevance:row.relevance,confidence:row.confidence===null?null:Number(row.confidence),createdAt:row.created_at?.toISOString?.()||row.created_at}; }
function mapAnalysis(row) { return {...payload(row),analysisId:row.id,analysis:row.analysis_jsonb,evidence:row.evidence_jsonb,provenance:row.provenance_jsonb,status:row.status}; }
function mapPriority(row) { return {...payload(row),priorityDecisionId:row.id,priority:row.priority,effectiveAt:row.effective_at?.toISOString?.()||row.effective_at}; }
module.exports = { PostgresRelevanceDecisionStore, PostgresIssueMatchDecisionStore, PostgresIssueAnalysisStore, PostgresIssuePriorityStore };
