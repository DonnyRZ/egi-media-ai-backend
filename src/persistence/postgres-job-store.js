const { randomUUID } = require("crypto");
const { jobKey } = require("../queue/job.store");

class PostgresJobStore {
  constructor({ db, uuid = randomUUID } = {}) { this.db = db; this.uuid = uuid; }
  async createOrGet({ tenantId, companyId, queueName, jobType, idempotencyKey, payload, maxAttempts = 3, availableAt = Date.now() }) {
    const id = this.uuid(); const result = await this.db.query("INSERT INTO ai.queue_jobs (id,tenant_id,company_id,queue_name,job_type,idempotency_key,payload_jsonb,status,max_attempts,available_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'queued',$8,$9) ON CONFLICT (tenant_id,company_id,queue_name,idempotency_key) DO NOTHING RETURNING *", [id,tenantId,companyId,queueName,jobType,idempotencyKey,JSON.stringify(payload),maxAttempts,new Date(availableAt).toISOString()]);
    if (result.rows[0]) return { job: mapJob(result.rows[0]), reused: false };
    const existing = await this.db.query("SELECT * FROM ai.queue_jobs WHERE tenant_id=$1 AND company_id=$2 AND queue_name=$3 AND idempotency_key=$4 LIMIT 1", [tenantId,companyId,queueName,idempotencyKey]);
    if (!existing.rows[0]) throw new Error("Queue job insert was not observable"); const job = mapJob(existing.rows[0]);
    if (job.jobType !== jobType || job.maxAttempts !== maxAttempts || JSON.stringify(job.payload) !== JSON.stringify(payload)) { const error = new Error("Idempotency key is already bound to a different job payload"); error.code = "QUEUE_IDEMPOTENCY_CONFLICT"; error.statusCode = 409; throw error; }
    return { job, reused: true };
  }
  async get({ tenantId, companyId, jobId }) { const r = await this.db.query("SELECT * FROM ai.queue_jobs WHERE id=$1 AND tenant_id=$2 AND company_id=$3", [jobId,tenantId,companyId]); return r.rows[0] ? mapJob(r.rows[0]) : null; }
  async list({ tenantId, companyId, status, queueName, jobTypes, limit, offset } = {}) {
    const values = [];
    const clauses = [];
    if (tenantId) { values.push(tenantId); clauses.push(`tenant_id=$${values.length}`); }
    if (companyId) { values.push(companyId); clauses.push(`company_id=$${values.length}`); }
    if (status) { values.push(status); clauses.push(`status=$${values.length}`); }
    if (queueName) { values.push(queueName); clauses.push(`queue_name=$${values.length}`); }
    if (jobTypes?.length) { values.push(jobTypes); clauses.push(`job_type = ANY($${values.length})`); }
    let sql = `SELECT * FROM ai.queue_jobs${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC`;
    if (limit != null) {
      values.push(limit);
      sql += ` LIMIT $${values.length}`;
      const start = Math.max(0, Number(offset) || 0);
      values.push(start);
      sql += ` OFFSET $${values.length}`;
    } else if (offset != null && Number(offset) > 0) {
      values.push(Math.max(0, Number(offset) || 0));
      sql += ` OFFSET $${values.length}`;
    }
    const r = await this.db.query(sql, values);
    return r.rows.map(mapJob);
  }
  async recoverStale({ olderThanMs = 300000 } = {}) { const r = await this.db.query("UPDATE ai.queue_jobs SET status='retrying',locked_by=NULL,locked_at=NULL,available_at=now(),updated_at=now() WHERE status='running' AND locked_at < now() - ($1::int * interval '1 millisecond')", [olderThanMs]); return r.rowCount; }
  async claimNext({ queueName, workerId, now = Date.now, tenantIds = null }) {
    const timestamp = new Date(typeof now === "function" ? now() : now).toISOString();
    const values = [workerId, timestamp, queueName];
    const scope = Array.isArray(tenantIds) && tenantIds.length ? ` AND tenant_id = ANY($${values.length + 1}::text[])` : "";
    if (scope) values.push(tenantIds);
    const r = await this.db.query(`UPDATE ai.queue_jobs SET status='running',attempts=attempts+1,locked_by=$1,locked_at=$2,updated_at=$2 WHERE id=(SELECT id FROM ai.queue_jobs WHERE queue_name=$3 AND status IN ('queued','retrying') AND available_at <= $2${scope} ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, values);
    return r.rows[0] ? mapJob(r.rows[0]) : null;
  }
  async complete({ jobId, workerId }) { return this._transition(jobId,workerId,"succeeded",{}); }
  async retry({ jobId, workerId, availableAt, errorCode, errorMessage }) { return this._transition(jobId,workerId,"retrying",{available_at:new Date(availableAt).toISOString(),last_error_code:errorCode,last_error_message:errorMessage}); }
  async deadLetter({ jobId, workerId, errorCode, errorMessage }) { return this._transition(jobId,workerId,"dead_letter",{last_error_code:errorCode,last_error_message:errorMessage,dead_lettered_at:new Date().toISOString()}); }
  async _transition(jobId,workerId,status,fields) { const sets=["status=$1","locked_by=NULL","locked_at=NULL","updated_at=now()"]; const values=[status,jobId,workerId]; for(const [column,value] of Object.entries(fields)){values.splice(values.length-2,0,value);sets.push(`${column}=$${values.length-2}`);} const r=await this.db.query(`UPDATE ai.queue_jobs SET ${sets.join(",")} WHERE id=$${values.length-1} AND locked_by=$${values.length} AND status='running' RETURNING *`,values); if(!r.rows[0]){const e=new Error("Job lock is not owned by this worker");e.code="QUEUE_LOCK_CONFLICT";throw e;} return mapJob(r.rows[0]); }
}
function mapJob(row){return {jobId:row.id,tenantId:row.tenant_id,companyId:row.company_id,queueName:row.queue_name,jobType:row.job_type,idempotencyKey:row.idempotency_key,payload:row.payload_jsonb,status:row.status,attempts:row.attempts,maxAttempts:row.max_attempts,availableAt:date(row.available_at),lockedBy:row.locked_by,lockedAt:date(row.locked_at),lastErrorCode:row.last_error_code,lastErrorMessage:row.last_error_message,deadLetteredAt:date(row.dead_lettered_at),createdAt:date(row.created_at),updatedAt:date(row.updated_at)};}
function date(value){return value?.toISOString?.()||value||null;}
module.exports={PostgresJobStore};
