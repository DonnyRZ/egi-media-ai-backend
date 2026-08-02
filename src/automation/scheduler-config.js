const Joi = require("joi");

const schema = Joi.object({
  AI_SCHEDULER_ENABLED: Joi.boolean().truthy("true").falsy("false").default(false),
  // Workers process ingest/pipeline queues independently of Automatic intake (scheduler).
  // Default true so manual "Pull articles now" still runs when AI_SCHEDULER_ENABLED=false.
  AI_WORKERS_ENABLED: Joi.boolean().truthy("true").falsy("false").default(true),
  AI_SCHEDULER_INTERVAL_MS: Joi.number().integer().min(1000).max(86400000).default(900000),
  AI_SCHEDULER_LOCALES: Joi.string().pattern(/^(id|en|uz)(,(id|en|uz))*$/).default("id"),
  AI_INGEST_BATCH_SIZE: Joi.number().integer().min(1).max(100).default(50),
  AI_INGEST_TIMEOUT_MS: Joi.number().integer().min(250).max(120000).default(30000),
  AI_INGEST_MAX_ATTEMPTS: Joi.number().integer().min(1).max(10).default(3),
  AI_INGEST_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(50).default(1),
  AI_PIPELINE_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(50).default(1),
  // Must exceed the longest provider request so a live AI job is not reclaimed as stale.
  AI_WORKER_STALE_TIMEOUT_MS: Joi.number().integer().min(1000).max(86400000).default(900000),
  AI_SCHEDULER_CATCH_UP: Joi.boolean().truthy("true").falsy("false").default(true),
}).unknown(true);

function readSchedulerConfig(env = process.env) {
  const { error, value } = schema.validate(env, { abortEarly: false, convert: true });
  if (error) throw Object.assign(new Error(`Invalid automation configuration: ${error.details.map((d) => d.message).join("; ")}`), { code: "AUTOMATION_CONFIGURATION_INVALID", statusCode: 503 });
  return {
    enabled: value.AI_SCHEDULER_ENABLED,
    workersEnabled: value.AI_WORKERS_ENABLED,
    intervalMs: value.AI_SCHEDULER_INTERVAL_MS,
    locales: value.AI_SCHEDULER_LOCALES.split(","),
    batchSize: value.AI_INGEST_BATCH_SIZE,
    timeoutMs: value.AI_INGEST_TIMEOUT_MS,
    maxAttempts: value.AI_INGEST_MAX_ATTEMPTS,
    ingestConcurrency: value.AI_INGEST_WORKER_CONCURRENCY,
    pipelineConcurrency: value.AI_PIPELINE_WORKER_CONCURRENCY,
    workerStaleTimeoutMs: value.AI_WORKER_STALE_TIMEOUT_MS,
    catchUp: value.AI_SCHEDULER_CATCH_UP,
  };
}

module.exports = { readSchedulerConfig };
