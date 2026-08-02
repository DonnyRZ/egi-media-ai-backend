const { InMemoryJobStore } = require("./job.store");

class JobQueueService {
  constructor({ jobStore = new InMemoryJobStore(), now = Date.now, workerId = "worker-default", backoff = defaultBackoff, isRetryable = defaultRetryable, logger = null } = {}) {
    this.jobStore = jobStore;
    this.now = now;
    this.workerId = workerId;
    this.backoff = backoff;
    this.isRetryable = isRetryable;
    this.logger = logger || { info() {}, warn() {}, error() {} };
  }

  enqueue({ tenantId, companyId, queueName, jobType, idempotencyKey, payload = {}, maxAttempts = 3, availableAt = this.now() }) {
    if (![tenantId, companyId, queueName, jobType, idempotencyKey].every((value) => typeof value === "string" && value.trim())) throw validationError("Queue job scope, type, and idempotency key are required");
    if (idempotencyKey.length < 16 || idempotencyKey.length > 255) throw validationError("Queue idempotency key must be 16 to 255 characters");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw validationError("Queue job payload must be an object");
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw validationError("Queue max attempts must be from 1 to 10");
    const result = this.jobStore.createOrGet({ tenantId, companyId, queueName, jobType, idempotencyKey, payload, maxAttempts, availableAt });
    this.logger.info("job_enqueued", { tenantId, companyId, queueName, jobType });
    return result;
  }

  async processNext({ queueName, handler, workerId = this.workerId } = {}) {
    if (typeof queueName !== "string" || typeof handler !== "function") throw validationError("Queue name and handler are required");
    const job = await this.jobStore.claimNext({ queueName, workerId, now: this.now() });
    if (!job) return null;
    this.logger.info("job_started", { tenantId: job.tenantId, companyId: job.companyId, jobId: job.jobId, queueName, jobType: job.jobType, attempt: job.attempts });
    try {
      const result = await handler(job);
      const completed = await this.jobStore.complete({ jobId: job.jobId, workerId });
      this.logger.info("job_succeeded", { tenantId: job.tenantId, companyId: job.companyId, jobId: job.jobId, queueName, jobType: job.jobType, attempt: job.attempts });
      return { job: completed, result };
    } catch (error) {
      const errorCode = typeof error?.code === "string" ? error.code : "JOB_FAILED";
      const errorMessage = safeErrorMessage(error);
      if (this.isRetryable(error) && job.attempts < job.maxAttempts) {
        const delayMs = Math.max(this.backoff({ attempt: job.attempts, job, error }), retryAfterDelay(error));
        const retried = await this.jobStore.retry({ jobId: job.jobId, workerId, availableAt: this.now() + delayMs, errorCode, errorMessage });
        this.logger.warn("job_retry_scheduled", { tenantId: job.tenantId, companyId: job.companyId, jobId: job.jobId, queueName, jobType: job.jobType, attempt: job.attempts, errorCode, delayMs });
        return { job: retried, retried: true, delayMs };
      }
      const deadLettered = await this.jobStore.deadLetter({ jobId: job.jobId, workerId, errorCode, errorMessage });
      this.logger.error("job_dead_lettered", { tenantId: job.tenantId, companyId: job.companyId, jobId: job.jobId, queueName, jobType: job.jobType, attempt: job.attempts, errorCode, error });
      return { job: deadLettered, retried: false, deadLettered: true };
    }
  }
}

function defaultBackoff({ attempt }) { return Math.min(300000, 1000 * (2 ** Math.max(0, attempt - 1))); }
function defaultRetryable(error) { return error?.retryable === true || ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "EHOSTUNREACH"].includes(error?.code); }
function retryAfterDelay(error) {
  if (error?.code !== "AI_PROVIDER_RATE_LIMITED") return 0;
  const details = error.details || {};
  // Honor provider reset hints long enough to avoid burning all bounded retries
  // before a token/request window has actually reset. Keep a finite ceiling so
  // malformed upstream values cannot schedule an unbounded queue delay.
  const providerResetMs = Math.max(Number(details.retryAfterMs) || 0, Number(details.resetRequestsMs) || 0, Number(details.resetTokensMs) || 0);
  return Math.min(24 * 60 * 60 * 1000, providerResetMs);
}
function safeErrorMessage(error) {
  const message = typeof error?.message === "string" && error.message.length <= 500 ? error.message : "Job handler failed";
  const details = error?.details || {};
  const diagnostic = [details.validationReason, details.providerErrorType, details.providerErrorCode]
    .find((value) => typeof value === "string" && value.trim() && value.length <= 120);
  const diagnostics = diagnostic ? [diagnostic.trim()] : [];
  if (error?.code === "AI_PROVIDER_RATE_LIMITED") {
    const provider = [details.providerErrorType, details.providerErrorCode]
      .filter((value) => typeof value === "string" && value.trim() && value.length <= 120)
      .map((value) => value.trim())
      .join("/");
    const hints = [
      ["retry_after_ms", details.retryAfterMs],
      ["reset_requests_ms", details.resetRequestsMs],
      ["reset_tokens_ms", details.resetTokensMs],
    ].filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
      .map(([name, value]) => `${name}=${Math.ceil(Number(value))}`);
    if (provider || hints.length) diagnostics.push(`rate_limit:${[provider, ...hints].filter(Boolean).join(",")}`);
  }
  if (diagnostics.length === 0) return message;
  return `${message} [diagnostic:${diagnostics.join(";")}]`.slice(0, 500);
}
function validationError(message) { const error = new Error(message); error.code = "VALIDATION_ERROR"; error.statusCode = 400; return error; }

module.exports = { JobQueueService, defaultBackoff, defaultRetryable };
