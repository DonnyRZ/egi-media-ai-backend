const { randomUUID } = require("crypto");
const JOB_STATUSES = Object.freeze(["queued", "running", "retrying", "succeeded", "dead_letter"]);
class InMemoryJobStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) { this.uuid = uuid; this.now = now; this.jobsById = new Map(); this.jobIdByKey = new Map(); }
  createOrGet({ tenantId, companyId, queueName, jobType, idempotencyKey, payload, maxAttempts = 3, availableAt = this.now() }) {
    const key = jobKey({ tenantId, companyId, queueName, idempotencyKey }); const existingId = this.jobIdByKey.get(key);
    if (existingId) { const existing = this.jobsById.get(existingId); if (!samePayload(existing, { jobType, payload, maxAttempts })) throw queueError("Idempotency key is already bound to a different job payload", "QUEUE_IDEMPOTENCY_CONFLICT"); return { job: clone(existing), reused: true }; }
    const job = { jobId: this.uuid(), tenantId, companyId, queueName, jobType, idempotencyKey, payload: structuredClone(payload), status: "queued", attempts: 0, maxAttempts, availableAt: new Date(availableAt).toISOString(), lockedBy: null, lockedAt: null, lastErrorCode: null, lastErrorMessage: null, deadLetteredAt: null, createdAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString() };
    this.jobsById.set(job.jobId, job); this.jobIdByKey.set(key, job.jobId); return { job: clone(job), reused: false };
  }
  get({ tenantId, companyId, jobId }) { const job = this.jobsById.get(jobId); return job && job.tenantId === tenantId && job.companyId === companyId ? clone(job) : null; }
  list({ tenantId, companyId, status, queueName, jobTypes, limit, offset = 0 } = {}) {
    let jobs = [...this.jobsById.values()].filter((job) => (!tenantId || job.tenantId === tenantId) && (!companyId || job.companyId === companyId) && (!status || job.status === status) && (!queueName || job.queueName === queueName) && (!jobTypes?.length || jobTypes.includes(job.jobType)));
    jobs.sort(compareJobsNewestFirst);
    const start = Math.max(0, Number(offset) || 0);
    if (start) jobs = jobs.slice(start);
    if (limit != null) jobs = jobs.slice(0, limit);
    return jobs.map(clone);
  }
  recoverStale({ olderThanMs = 300000, now = this.now() } = {}) { const cutoff = now - olderThanMs; let count = 0; for (const job of this.jobsById.values()) if (job.status === "running" && Date.parse(job.lockedAt || job.updatedAt) < cutoff) { job.status = "retrying"; job.lockedBy = null; job.lockedAt = null; job.availableAt = new Date(now).toISOString(); job.updatedAt = new Date(now).toISOString(); count += 1; } return count; }
  claimNext({ queueName, workerId, now = this.now() }) { const candidate = [...this.jobsById.values()].filter((job) => job.queueName === queueName && ["queued", "retrying"].includes(job.status) && Date.parse(job.availableAt) <= now).sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt) || Date.parse(a.createdAt) - Date.parse(b.createdAt))[0]; if (!candidate) return null; const timestamp = new Date(now).toISOString(); candidate.status = "running"; candidate.attempts += 1; candidate.lockedBy = workerId; candidate.lockedAt = timestamp; candidate.updatedAt = timestamp; return clone(candidate); }
  complete({ jobId, workerId }) { const job = this._locked(jobId, workerId); job.status = "succeeded"; job.lockedBy = null; job.lockedAt = null; job.updatedAt = new Date(this.now()).toISOString(); return clone(job); }
  retry({ jobId, workerId, availableAt, errorCode, errorMessage }) { const job = this._locked(jobId, workerId); job.status = "retrying"; job.availableAt = new Date(availableAt).toISOString(); job.lockedBy = null; job.lockedAt = null; job.lastErrorCode = errorCode; job.lastErrorMessage = errorMessage; job.updatedAt = new Date(this.now()).toISOString(); return clone(job); }
  deadLetter({ jobId, workerId, errorCode, errorMessage }) { const job = this._locked(jobId, workerId); const now = new Date(this.now()).toISOString(); job.status = "dead_letter"; job.lockedBy = null; job.lockedAt = null; job.lastErrorCode = errorCode; job.lastErrorMessage = errorMessage; job.deadLetteredAt = now; job.updatedAt = now; return clone(job); }
  _locked(jobId, workerId) { const job = this.jobsById.get(jobId); if (!job || job.status !== "running" || job.lockedBy !== workerId) throw queueError("Job lock is not owned by this worker", "QUEUE_LOCK_CONFLICT"); return job; }
}
function compareJobsNewestFirst(a, b) {
  const byCreated = Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
  if (byCreated !== 0) return byCreated;
  return String(b.jobId || "").localeCompare(String(a.jobId || ""));
}
function samePayload(existing, requested) { return existing.jobType === requested.jobType && existing.maxAttempts === requested.maxAttempts && JSON.stringify(existing.payload) === JSON.stringify(requested.payload); }
function jobKey({ tenantId, companyId, queueName, idempotencyKey }) { return `${tenantId}|${companyId}|${queueName}|${idempotencyKey}`; }
function clone(value) { return structuredClone(value); }
function queueError(message, code) { const error = new Error(message); error.code = code; error.statusCode = 409; return error; }
module.exports = { InMemoryJobStore, JOB_STATUSES, jobKey, compareJobsNewestFirst };
