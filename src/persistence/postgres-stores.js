const { randomUUID } = require("crypto");
const { PostgresRecordStore } = require("./postgres-record-store");
const { branchForDecision } = require("../ai/tasks/t02-relevance-class/relevance-policy");
const { resolvePipelineId } = require("../pipeline/pipeline-trace");

const json = (value) => JSON.stringify(value ?? {});
const payload = (row) => row.payload_jsonb || {};

class PostgresRelevanceDecisionStore extends PostgresRecordStore {
  constructor(options) { super({ ...options, table: "ai.article_relevance", mapRow: mapRelevance }); }
  async get({ tenantId, articleId, companyId, contextVersion, inputFingerprint }) {
    const result = tenantId
      ? await this.db.query("SELECT * FROM ai.article_relevance WHERE tenant_id=$1 AND company_id=$2 AND article_snapshot_id=$3 AND context_id=$4 AND payload_jsonb->>'inputFingerprint'=$5 LIMIT 1", [tenantId, companyId, articleId, contextVersion, inputFingerprint])
      : await this.db.query("SELECT * FROM ai.article_relevance WHERE company_id=$1 AND article_snapshot_id=$2 AND context_id=$3 AND payload_jsonb->>'inputFingerprint'=$4 LIMIT 1", [companyId, articleId, contextVersion, inputFingerprint]);
    return result.rows[0] ? mapRelevance(result.rows[0]) : null;
  }
  async getById(decisionId) { return this.findOne({ id: decisionId }); }
  async getLatest({ tenantId, articleId, companyId, contextVersion }) {
    const result = await this.db.query(
      `SELECT * FROM ai.article_relevance
       WHERE tenant_id=$1 AND company_id=$2 AND article_snapshot_id=$3 AND context_id=$4
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, companyId, articleId, contextVersion],
    );
    return result.rows[0] ? mapRelevance(result.rows[0]) : null;
  }
  async create({ tenantId = "unknown", articleId, companyId, contextVersion, identityFingerprint = null, inputFingerprint, source, output, provenance, pipelineId = null }) {
    const subjectRelation = output.subject_relation ?? null;
    const competitorOptIn = output.competitor_opt_in === true;
    const id = this.uuid();
    const value = {
      decisionId: id, tenantId, articleId, companyId, contextVersion, identityFingerprint, inputFingerprint, source,
      relevance: output.relevance, confidence: output.confidence,
      subjectRelation, competitorOptIn,
      branch: branchForDecision({ relevance: output.relevance, subjectRelation }),
      provenance, pipelineId, createdAt: new Date().toISOString(),
    };
    const payload = json({ ...value, source, inputFingerprint });
    // Upsert when fingerprint changes so identity-gate reclassifications replace stale continues.
    const result = await this.db.query(
      `INSERT INTO ai.article_relevance (id,tenant_id,company_id,article_snapshot_id,context_id,relevance,confidence,payload_jsonb)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (tenant_id,company_id,article_snapshot_id,context_id) DO UPDATE SET
         relevance = EXCLUDED.relevance,
         confidence = EXCLUDED.confidence,
         payload_jsonb = EXCLUDED.payload_jsonb
       WHERE ai.article_relevance.payload_jsonb->>'inputFingerprint' IS DISTINCT FROM EXCLUDED.payload_jsonb->>'inputFingerprint'
       RETURNING *`,
      [id, tenantId, companyId, articleId, contextVersion, output.relevance, output.confidence ?? null, payload],
    );
    if (result.rows[0]) return mapRelevance(result.rows[0]);
    return this.get({ tenantId, articleId, companyId, contextVersion, inputFingerprint });
  }
}

class PostgresIssueMatchDecisionStore extends PostgresRecordStore {
  constructor(options) { super({ ...options, table: "ai.stage_runs", mapRow: payload }); }
  async get({ tenantId, companyId, relevanceDecisionId, promptVersion }) { const values = await this.list({tenantId, companyId}); return values.find((v) => v.task === "T04" && v.relevanceDecisionId === relevanceDecisionId && v.promptVersion === promptVersion) || null; }
  async getById(matchDecisionId) { return this.findOne({ id:matchDecisionId }); }
  async create({ tenantId, companyId, relevanceDecisionId, promptVersion, output, provenance, pipelineId = null, inputFingerprint = null }) { const id=this.uuid(); const value={matchDecisionId:id,tenantId,companyId,relevanceDecisionId,promptVersion,decision:output.decision,candidateIssueId:output.candidate_issue_id,reasonCode:output.reason_code,provenance,pipelineId,inputFingerprint,createdAt:new Date().toISOString(),task:"T04"}; const pipelineRunId=resolvePipelineId(value); await this.db.query("INSERT INTO ai.stage_runs (id,pipeline_run_id,tenant_id,company_id,task,input_fingerprint,output_jsonb,validation_status,model,prompt_id,prompt_version,provider_request_id,attempts,started_at,completed_at,payload_jsonb) VALUES ($1,$2,$3,$4,'T04',$5,$6::jsonb,'validated',$7,$8,$9,$10,1,$11,$12,$13::jsonb)",[id,pipelineRunId,tenantId,companyId,inputFingerprint,json(output),provenance?.model || null,provenance?.promptId || null,promptVersion,provenance?.providerRequestId || null,provenance?.createdAt || null,value.createdAt,json(value)]); return value; }
}

class PostgresIssueAnalysisStore extends PostgresRecordStore {
  constructor(options) { super({ ...options, table:"ai.issue_analyses", mapRow:mapAnalysis }); }
  async get({tenantId,companyId,issueId,inputFingerprint,promptVersion}) { const r=await this.db.query("SELECT * FROM ai.issue_analyses WHERE tenant_id=$1 AND company_id=$2 AND issue_id=$3 AND input_fingerprint=$4 AND prompt_version=$5 LIMIT 1",[tenantId,companyId,issueId,inputFingerprint,promptVersion]); return r.rows[0]?mapAnalysis(r.rows[0]):null; }
  async getById(id) { return this.findOne({id}); }
  async getCurrent({tenantId,companyId,issueId}) { const r=await this.db.query("SELECT * FROM ai.issue_analyses WHERE tenant_id=$1 AND company_id=$2 AND issue_id=$3 AND status='current' ORDER BY valid_at DESC NULLS LAST LIMIT 1",[tenantId,companyId,issueId]); return r.rows[0]?mapAnalysis(r.rows[0]):null; }
  async create(value) { const id=this.uuid(); await this.db.query("INSERT INTO ai.issue_analyses (id,tenant_id,company_id,issue_id,input_fingerprint,prompt_version,status,analysis_jsonb,evidence_jsonb,provenance_jsonb) VALUES ($1,$2,$3,$4,$5,$6,'validated',$7::jsonb,$8::jsonb,$9::jsonb)",[id,value.tenantId,value.companyId,value.issueId,value.inputFingerprint,value.promptVersion,json(value.analysis),json(value.evidence),json(value.provenance)]); return {analysisId:id,...value,status:"validated"}; }
  async promoteCurrent({ tenantId, companyId, analysisId, gate }) {
    const current = await this.getById(analysisId);
    if (!current || current.tenantId !== tenantId || current.companyId !== companyId || current.status !== "validated") {
      throw new Error("Analysis cannot be promoted as current");
    }
    const validAt = gate?.checkedAt || new Date().toISOString();
    await this.db.query("UPDATE ai.issue_analyses SET status='superseded' WHERE tenant_id=$1 AND company_id=$2 AND issue_id=$3 AND status='current' AND id<>$4", [tenantId, companyId, current.issueId, analysisId]);
    const result = await this.db.query("UPDATE ai.issue_analyses SET status='current',valid_at=$1,provenance_jsonb=jsonb_set(COALESCE(provenance_jsonb,'{}'::jsonb),'{gate}',$2::jsonb,true) WHERE id=$3 AND tenant_id=$4 AND company_id=$5 AND status='validated' RETURNING *", [validAt, json(gate || {}), analysisId, tenantId, companyId]);
    return result.rows[0] ? mapAnalysis(result.rows[0]) : this.getCurrent({ tenantId, companyId, issueId: current.issueId });
  }
}

class PostgresIssuePriorityStore extends PostgresRecordStore {
  constructor(options) { super({ ...options, table:"ai.issue_priorities", mapRow:mapPriority }); }
  async get({tenantId,companyId,issueId,analysisId}) { const r=await this.db.query("SELECT * FROM ai.issue_priorities WHERE tenant_id=$1 AND company_id=$2 AND issue_id=$3 AND analysis_id=$4 ORDER BY effective_at DESC LIMIT 1",[tenantId,companyId,issueId,analysisId]); return r.rows[0]?mapPriority(r.rows[0]):null; }
  async create(value) { const id=this.uuid(); await this.db.query("INSERT INTO ai.issue_priorities (id,tenant_id,company_id,issue_id,analysis_id,priority,provenance_jsonb,effective_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",[id,value.tenantId,value.companyId,value.issueId,value.analysisId,value.priority,json(value.provenance),value.effectiveAt||new Date().toISOString()]); return {priorityDecisionId:id,...value}; }
}

class PostgresSavedIssueStore {
  constructor({ db, uuid = randomUUID } = {}) { this.db = db; this.uuid = uuid; }
  async save({ tenantId, companyId, actorId, issueId }) {
    const id = this.uuid(); const result = await this.db.query("INSERT INTO ai.saved_issues (id,tenant_id,company_id,actor_id,issue_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,company_id,actor_id,issue_id) DO UPDATE SET issue_id=EXCLUDED.issue_id RETURNING *", [id,tenantId,companyId,actorId,issueId]);
    return { saved: mapSaved(result.rows[0]), reused: result.rows[0].id !== id };
  }
  async remove({ tenantId, companyId, actorId, issueId }) { const result = await this.db.query("DELETE FROM ai.saved_issues WHERE tenant_id=$1 AND company_id=$2 AND actor_id=$3 AND issue_id=$4 RETURNING issue_id", [tenantId,companyId,actorId,issueId]); return { removed: result.rowCount > 0 }; }
  async list({ tenantId, companyId, actorId, page = 1, limit = 20 }) { const count = await this.db.query("SELECT count(*)::int AS total FROM ai.saved_issues WHERE tenant_id=$1 AND company_id=$2 AND actor_id=$3", [tenantId,companyId,actorId]); const offset=(page-1)*limit; const rows=await this.db.query("SELECT * FROM ai.saved_issues WHERE tenant_id=$1 AND company_id=$2 AND actor_id=$3 ORDER BY created_at DESC LIMIT $4 OFFSET $5", [tenantId,companyId,actorId,limit,offset]); return { items: rows.rows.map(mapSaved), page, limit, total: count.rows[0].total }; }
}

class PostgresAlertEventStore {
  constructor({ db, uuid = randomUUID } = {}) { this.db = db; this.uuid = uuid; }
  async findEligibleByDedupeKey(dedupeKey) { const result=await this.db.query("SELECT * FROM ai.alert_events WHERE dedupe_key=$1 AND status='eligible' LIMIT 1",[dedupeKey]); return result.rows[0] ? mapAlertEvent(result.rows[0]) : null; }
  async get({ tenantId, companyId, alertEventId }) { const result=await this.db.query("SELECT * FROM ai.alert_events WHERE id=$1 AND tenant_id=$2 AND company_id=$3 LIMIT 1",[alertEventId,tenantId,companyId]); return result.rows[0] ? mapAlertEvent(result.rows[0]) : null; }
  async create({ tenantId, companyId, issueId, developmentId, recipientId, channel, status, reasonCode, dedupeKey }) { const id=this.uuid(); const result=await this.db.query("INSERT INTO ai.alert_events (id,tenant_id,company_id,issue_id,development_id,recipient_ref,channel,status,reason_code,dedupe_key,payload_jsonb) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT (dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING *",[id,tenantId,companyId,issueId,developmentId,recipientId,channel,status,reasonCode,dedupeKey,JSON.stringify({read:false})]); return mapAlertEvent(result.rows[0]); }
  async listScoped({ tenantId, companyId, recipientId = null, channel = null, page = 1, limit = 20 }) {
    const baseValues=[tenantId,companyId]; let baseWhere="tenant_id=$1 AND company_id=$2";
    if(recipientId){baseValues.push(recipientId);baseWhere+=` AND recipient_ref=$${baseValues.length}`;}
    const unread=await this.db.query(`SELECT channel,count(*)::int AS total FROM ai.alert_events WHERE ${baseWhere} AND read_at IS NULL GROUP BY channel`,baseValues);
    const values=[...baseValues]; let where=baseWhere;
    if(channel){values.push(channel);where+=` AND channel=$${values.length}`;}
    const count=await this.db.query(`SELECT count(*)::int AS total FROM ai.alert_events WHERE ${where}`,values);
    values.push(limit,(page-1)*limit);
    const rows=await this.db.query(`SELECT * FROM ai.alert_events WHERE ${where} ORDER BY created_at DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    return {items:rows.rows.map(mapAlertEvent),page,limit,total:count.rows[0].total,unreadByChannel:{langsung:0,ringkasan:0,...Object.fromEntries(unread.rows.map((row)=>[row.channel,Number(row.total)]))}};
  }
  async markRead({ tenantId, companyId, alertEventId, read = true }) { const result=await this.db.query("UPDATE ai.alert_events SET read_at=$1 WHERE id=$2 AND tenant_id=$3 AND company_id=$4 RETURNING *",[read?new Date().toISOString():null,alertEventId,tenantId,companyId]); return result.rows[0] ? mapAlertEvent(result.rows[0]) : null; }
  async markContentBlocked({ tenantId, companyId, alertEventId, reasonCode }) { const result=await this.db.query("UPDATE ai.alert_events SET status='blocked_invalid_content',reason_code=$1,content_blocked_at=now() WHERE id=$2 AND tenant_id=$3 AND company_id=$4 RETURNING *",[reasonCode,alertEventId,tenantId,companyId]); return result.rows[0] ? mapAlertEvent(result.rows[0]) : null; }
  async markDeliveryBlocked({ tenantId, companyId, alertEventId, reasonCode }) { const result=await this.db.query("UPDATE ai.alert_events SET status='blocked_delivery_fields',reason_code=$1,delivery_blocked_at=now() WHERE id=$2 AND tenant_id=$3 AND company_id=$4 RETURNING *",[reasonCode,alertEventId,tenantId,companyId]); return result.rows[0] ? mapAlertEvent(result.rows[0]) : null; }
}
class PostgresAlertPreferenceStore {
  constructor({ db }) { this.db=db; }
  async get({ tenantId, companyId, recipientId }) { const r=await this.db.query("SELECT * FROM ai.alert_preferences WHERE tenant_id=$1 AND company_id=$2 AND user_ref=$3 LIMIT 1",[tenantId,companyId,recipientId]); return r.rows[0]?mapPreference(r.rows[0]):null; }
  async getAny({ tenantId, companyId }) { const r=await this.db.query("SELECT * FROM ai.alert_preferences WHERE tenant_id=$1 AND company_id=$2 ORDER BY updated_at DESC LIMIT 1",[tenantId,companyId]); return r.rows[0]?mapPreference(r.rows[0]):null; }
  async upsert({ tenantId, companyId, recipientId, directHighEnabled, dailyDigestEnabled, timezone, quietHours }) { const id=randomUUID(); const r=await this.db.query("INSERT INTO ai.alert_preferences (id,tenant_id,company_id,user_ref,direct_high_enabled,daily_digest_enabled,timezone,quiet_hours_jsonb) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (tenant_id,company_id,user_ref) DO UPDATE SET direct_high_enabled=EXCLUDED.direct_high_enabled,daily_digest_enabled=EXCLUDED.daily_digest_enabled,timezone=EXCLUDED.timezone,quiet_hours_jsonb=EXCLUDED.quiet_hours_jsonb,updated_at=now() RETURNING *",[id,tenantId,companyId,recipientId,directHighEnabled,dailyDigestEnabled,timezone,JSON.stringify(quietHours)]); return mapPreference(r.rows[0]); }
}

class PostgresReportDraftStore {
  constructor({ db, uuid = randomUUID } = {}) { this.db = db; this.uuid = uuid; }
  async createDraft(value) { const id=value.reportId && value.reportId !== "draft-validation" ? value.reportId : this.uuid(); const now=new Date().toISOString(); const payload={...value,reportId:id,version:1,reviewStatus:"draft",activity:[],createdAt:now,updatedAt:now}; const result=await this.db.query("INSERT INTO ai.reports (id,tenant_id,company_id,report_type,period_start,period_end,timezone,review_status,payload_jsonb) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8::jsonb) RETURNING *",[id,value.tenantId,value.companyId,value.reportType,value.periodStart,value.periodEnd,value.timezone,JSON.stringify(payload)]); return this._withSourceMetadata(mapReport(result.rows[0])); }
  async get({ tenantId, companyId, reportId }) { const result=await this.db.query("SELECT * FROM ai.reports WHERE id=$1 AND tenant_id=$2 AND company_id=$3 LIMIT 1",[reportId,tenantId,companyId]); return result.rows[0] ? this._withSourceMetadata(mapReport(result.rows[0])) : null; }
  async list({ tenantId, companyId, page=1, limit=20, reportType=null, reviewStatus=null }) { const values=[tenantId,companyId]; const predicates=["tenant_id=$1","company_id=$2"]; if(reportType){values.push(reportType);predicates.push(`report_type=$${values.length}`);} if(reviewStatus){values.push(reviewStatus);predicates.push(`review_status=$${values.length}`);} const where=predicates.join(" AND "); const count=await this.db.query(`SELECT count(*)::int AS total FROM ai.reports WHERE ${where}`,values); values.push(limit,(page-1)*limit); const rows=await this.db.query(`SELECT * FROM ai.reports WHERE ${where} ORDER BY updated_at DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values); return {items:await Promise.all(rows.rows.map((row)=>this._withSourceMetadata(mapReport(row)))),page,limit,total:count.rows[0].total}; }
  async _withSourceMetadata(report) {
    const ids = [...new Set((report.selectedIssuePack || []).flatMap((item) => (item.citations || []).map((citation) => citation.sourceArticleId)).filter(Boolean))];
    if (!ids.length) return report;
    const rows = await this.db.query("SELECT source_article_id, article_jsonb, published_at, canonical_url FROM ai.article_snapshots WHERE source_article_id = ANY($1::text[])", [ids]);
    const metadata = new Map(rows.rows.map((row) => [row.source_article_id, { title: nonEmpty(row.article_jsonb?.title), sourceName: reportSourceName(row.source_article_id, row.article_jsonb, row.canonical_url), publishedAt: row.published_at?.toISOString?.() || row.published_at || null, canonicalUrl: row.canonical_url || null }]));
    return { ...report, selectedIssuePack: (report.selectedIssuePack || []).map((item) => ({ ...item, citations: (item.citations || []).map((citation) => ({ ...citation, ...(metadata.get(citation.sourceArticleId) || {}) })) })) };
  }
  async transition({ tenantId, companyId, reportId, expectedVersion, nextStatus, actor, action, note=null, shareTarget=null }) { const current=await this.get({tenantId,companyId,reportId}); if(!current || current.version !== expectedVersion) return { conflict:{ expectedVersion, actualVersion:current?.version } }; const now=new Date().toISOString(); const payload={...current,reviewStatus:nextStatus,version:current.version+1,updatedAt:now,activity:[...(current.activity||[]),{action,actorId:actor.actorId,actorType:actor.actorType,note,shareTargetHash:shareTarget?require("crypto").createHash("sha256").update(JSON.stringify(shareTarget)).digest("hex"):null,at:now,version:current.version+1}]}; const result=await this.db.query("UPDATE ai.reports SET review_status=$1,payload_jsonb=$2::jsonb,updated_at=$3 WHERE id=$4 AND tenant_id=$5 AND company_id=$6 AND payload_jsonb->>'version'=$7 RETURNING *",[nextStatus,JSON.stringify(payload),now,reportId,tenantId,companyId,String(expectedVersion)]); return result.rows[0] ? {report:mapReport(result.rows[0])} : {conflict:{expectedVersion,actualVersion:current.version}}; }
  async markNarrativeInvalid({ tenantId, companyId, reportId, reasonCode }) { const current=await this.get({tenantId,companyId,reportId}); if(!current)return null; const now=new Date().toISOString(); const payload={...current,reviewStatus:"needs_review",narrativeFailureCode:reasonCode,version:current.version+1,updatedAt:now}; const result=await this.db.query("UPDATE ai.reports SET review_status='needs_review',payload_jsonb=$1::jsonb,updated_at=$2 WHERE id=$3 AND tenant_id=$4 AND company_id=$5 RETURNING *",[JSON.stringify(payload),now,reportId,tenantId,companyId]); return result.rows[0]?mapReport(result.rows[0]):null; }
}
class PostgresReportNarrativeStore {
  constructor({ db, uuid = randomUUID } = {}) { this.db=db; this.uuid=uuid; }
  async get({ reportId, promptVersion }) { const r=await this.db.query("SELECT rv.*,r.tenant_id,r.company_id FROM ai.report_versions rv JOIN ai.reports r ON r.id=rv.report_id WHERE rv.report_id=$1 AND rv.content_jsonb->>'promptVersion'=$2 ORDER BY rv.version DESC LIMIT 1",[reportId,promptVersion]); return r.rows[0]?mapNarrative(r.rows[0]):null; }
  async getById({ tenantId, companyId, reportNarrativeId }) { const r=await this.db.query("SELECT rv.*,r.tenant_id,r.company_id FROM ai.report_versions rv JOIN ai.reports r ON r.id=rv.report_id WHERE rv.id=$1 AND r.tenant_id=$2 AND r.company_id=$3",[reportNarrativeId,tenantId,companyId]); return r.rows[0]?mapNarrative(r.rows[0]):null; }
  async create({ tenantId, companyId, reportId, promptVersion, narrative, provenance }) { const existing=await this.get({reportId,promptVersion}); if(existing)return existing; const id=this.uuid(); const payload={promptVersion,narrative,rewrites:[]}; const r=await this.db.query("INSERT INTO ai.report_versions (id,report_id,version,content_jsonb,metrics_jsonb,provenance_jsonb,review_status,author_ref) VALUES ($1,$2,1,$3::jsonb,'{}'::jsonb,$4::jsonb,'draft',$5) RETURNING *",[id,reportId,JSON.stringify(payload),JSON.stringify(provenance),null]); return mapNarrative({...r.rows[0],tenant_id:tenantId,company_id:companyId}); }
  async applyConstrainedRewrite({ tenantId, companyId, reportNarrativeId, expectedVersion, allowedSpanId, replacementText, actor, humanInstruction, provenance }) { const current=await this.getById({tenantId,companyId,reportNarrativeId}); if(!current || current.version!==expectedVersion)return {conflict:{expectedVersion,actualVersion:current?.version}}; const span=resolveConstrainedSpan(current.narrative,allowedSpanId); const narrative=span?replaceConstrainedSpan(current.narrative,span,replacementText):null; if(!narrative)return null; const next={...current.narrative,rewrites:[...(current.narrative.rewrites||[]),{rewriteId:this.uuid(),allowedSpanId,sourceClaimIds:span.sourceClaimIds,actorId:actor.actorId,actorType:actor.actorType,instructionHash:require("crypto").createHash("sha256").update(humanInstruction).digest("hex"),provenance,createdAt:new Date().toISOString(),version:current.version+1}]}; const id=this.uuid(); const r=await this.db.query("INSERT INTO ai.report_versions (id,report_id,version,content_jsonb,metrics_jsonb,provenance_jsonb,review_status,author_ref) VALUES ($1,$2,$3,$4::jsonb,'{}'::jsonb,$5::jsonb,'draft',$6) RETURNING *",[id,current.reportId,current.version+1,JSON.stringify({...next,promptVersion:current.promptVersion}),JSON.stringify(provenance),actor.actorId]); return {narrative:mapNarrative({...r.rows[0],tenant_id:tenantId,company_id:companyId})}; }
}
function mapRelevance(row) {
  const base = payload(row);
  const relevance = row.relevance;
  const subjectRelation = base.subjectRelation ?? base.subject_relation ?? null;
  const competitorOptIn = base.competitorOptIn === true || base.competitor_opt_in === true;
  return {
    ...base,
    decisionId: row.id,
    relevance,
    confidence: row.confidence === null ? null : Number(row.confidence),
    subjectRelation,
    competitorOptIn,
    // Recompute branch so legacy continue rows and market leaks cannot reopen issue formation.
    branch: branchForDecision({ relevance, subjectRelation }),
    createdAt: row.created_at?.toISOString?.() || row.created_at,
  };
}
function mapAnalysis(row) { return {...payload(row),analysisId:row.id,tenantId:row.tenant_id,companyId:row.company_id,issueId:row.issue_id,inputFingerprint:row.input_fingerprint,promptVersion:row.prompt_version,analysis:row.analysis_jsonb,evidence:row.evidence_jsonb,provenance:row.provenance_jsonb,gate:row.provenance_jsonb?.gate || null,status:row.status}; }
function mapPriority(row) { return {...payload(row),priorityDecisionId:row.id,tenantId:row.tenant_id,companyId:row.company_id,issueId:row.issue_id,analysisId:row.analysis_id,priority:row.priority,effectiveAt:row.effective_at?.toISOString?.()||row.effective_at}; }
function mapSaved(row) { return { savedId: row.id, tenantId: row.tenant_id, companyId: row.company_id, actorId: row.actor_id, issueId: row.issue_id, savedAt: row.created_at?.toISOString?.() || row.created_at }; }
function mapAlertEvent(row) { const payload=row.payload_jsonb||{}; return { alertEventId:row.id, tenantId:row.tenant_id, companyId:row.company_id, issueId:row.issue_id, developmentId:row.development_id, recipientId:row.recipient_ref, channel:row.channel, status:row.status, reasonCode:row.reason_code, dedupeKey:row.dedupe_key, read:Boolean(row.read_at), readAt:row.read_at, createdAt:row.created_at?.toISOString?.()||row.created_at, ...payload }; }
function mapReport(row) { const payload = row.payload_jsonb || {}; return { ...payload, reportId:row.id, tenantId:row.tenant_id, companyId:row.company_id, reportType:row.report_type, periodStart:payload.periodStart || dateText(row.period_start), periodEnd:payload.periodEnd || dateText(row.period_end), timezone:row.timezone, reviewStatus:row.review_status, updatedAt:row.updated_at?.toISOString?.()||row.updated_at, createdAt:row.created_at?.toISOString?.()||row.created_at }; }
function nonEmpty(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function reportSourceName(sourceArticleId, article, canonicalUrl) { const explicit = nonEmpty(article?.sourceName) || nonEmpty(article?.source_name) || nonEmpty(article?.publisher) || nonEmpty(article?.media); if (explicit) return explicit; const provider = /^crawl:([^:]+):/i.exec(sourceArticleId || "")?.[1]; if (provider) return provider.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); try { return new URL(canonicalUrl).hostname.replace(/^www\./, ""); } catch { return "Source"; } }
function dateText(value) { return value?.toISOString ? value.toISOString().slice(0,10) : String(value).slice(0,10); }
function mapPreference(row) { return { tenantId:row.tenant_id, companyId:row.company_id, recipientId:row.user_ref, directHighEnabled:row.direct_high_enabled, dailyDigestEnabled:row.daily_digest_enabled, timezone:row.timezone, quietHours:row.quiet_hours_jsonb || null, createdAt:row.created_at?.toISOString?.()||row.created_at, updatedAt:row.updated_at?.toISOString?.()||row.updated_at }; }
function mapNarrative(row) { const payload=row.content_jsonb||{}; return { reportNarrativeId:row.id, tenantId:row.tenant_id, companyId:row.company_id, reportId:row.report_id, promptVersion:payload.promptVersion, narrative:payload.narrative, provenance:row.provenance_jsonb||{}, reviewStatus:row.review_status, version:row.version, rewrites:payload.rewrites||[], createdAt:row.created_at?.toISOString?.()||row.created_at, updatedAt:row.created_at?.toISOString?.()||row.created_at }; }
module.exports = { PostgresRelevanceDecisionStore, PostgresIssueMatchDecisionStore, PostgresIssueAnalysisStore, PostgresIssuePriorityStore, PostgresSavedIssueStore, PostgresAlertEventStore, PostgresAlertPreferenceStore, PostgresReportDraftStore, PostgresReportNarrativeStore };
