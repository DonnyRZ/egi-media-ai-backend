class PollEnqueueService {
  constructor({ queue, sourceName = "egi-media-cms", maxAttempts = 3, now = Date.now } = {}) { if (!queue?.enqueue) throw new TypeError("Poll enqueue service requires a queue"); this.queue = queue; this.sourceName = sourceName; this.maxAttempts = maxAttempts; this.now = now; }
  enqueuePoll({ tenantId, companyId, locale, limit, trigger = "scheduled", scheduleKey = "default" }) { const idempotencyKey = `poll-${this.sourceName}-${tenantId}-${companyId}-${locale}-${scheduleKey}-${new Date(this.now()).toISOString().slice(0, 16)}`; return this.queue.enqueue({ tenantId, companyId, queueName: "ingest", jobType: "cms.poll", idempotencyKey, maxAttempts: this.maxAttempts, payload: { mode: "poll", locale, limit, trigger, source_name: this.sourceName } }); }
}
module.exports = { PollEnqueueService };
