require("dotenv").config();
const confidence = require("confidence");
const { readSchedulerConfig } = require("../automation/scheduler-config");

function listenHost() {
  const requested = process.env.APP_HOST || "localhost";
  // Railway injects PORT and probes the container. Binding localhost would fail healthchecks.
  if (process.env.PORT && (requested === "localhost" || requested === "127.0.0.1")) {
    return "0.0.0.0";
  }
  return requested;
}

const config = {
  host: listenHost(),
  env: process.env.APP_ENV || "development",
  port: Number(process.env.PORT || process.env.APP_PORT || 5003),
  cors: {
    origins: process.env.CORS_ORIGINS || "http://localhost:3000",
  },
  cms: {
    baseUrl: process.env.CMS_BASE_URL || "http://localhost:5002",
    timeoutMs: Number(process.env.CMS_TIMEOUT_MS || 10000),
  },
  portal: {
    baseUrl: process.env.PORTAL_BASE_URL || "http://localhost:3000",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    // Single production model: both task aliases resolve to the same slug.
    model: process.env.OPENAI_MODEL || process.env.OPENAI_MINI_MODEL || process.env.OPENAI_NANO_MODEL,
    miniModel: process.env.OPENAI_MINI_MODEL || process.env.OPENAI_MODEL,
    nanoModel: process.env.OPENAI_NANO_MODEL || process.env.OPENAI_MODEL,
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 30000),
    t01TimeoutMs: Number(process.env.OPENAI_T01_TIMEOUT_MS || 120000),
    t07TimeoutMs: Number(process.env.OPENAI_T07_TIMEOUT_MS || 90000),
    rateLimit: {
      maxConcurrency: Number(process.env.OPENAI_MAX_CONCURRENCY || 2),
      requestsPerMinute: Number(process.env.OPENAI_RATE_LIMIT_RPM || 0),
      tokensPerMinute: Number(process.env.OPENAI_RATE_LIMIT_TPM || 0),
      safetyRatio: Number(process.env.OPENAI_RATE_LIMIT_SAFETY_RATIO || 0.8),
      outputTokenReserve: Number(process.env.OPENAI_OUTPUT_TOKEN_RESERVE || 1000),
    },
  },
  auth: {
    accessTokenSecret: process.env.AUTH_ACCESS_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET,
    serviceAuthSecret: process.env.AI_SERVICE_AUTH_SECRET,
    bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL,
    bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  },
  email: {
    transport: process.env.EMAIL_TRANSPORT || "smtp",
    smtp: {
      host: process.env.EMAIL_SMTP_HOST,
      port: Number(process.env.EMAIL_SMTP_PORT || 465),
      secure: process.env.EMAIL_SMTP_SECURE === "true",
      user: process.env.EMAIL_SMTP_USER,
      appPassword: process.env.EMAIL_SMTP_APP_PASSWORD,
    },
    from: { address: process.env.EMAIL_FROM_ADDRESS, name: process.env.EMAIL_FROM_NAME || "EGI Media" },
    retry: { maxAttempts: Number(process.env.EMAIL_RETRY_MAX_ATTEMPTS || 3), baseDelayMs: Number(process.env.EMAIL_RETRY_BASE_DELAY_MS || 1000) },
  },
  database: {
    sourceUrl: process.env.SOURCE_DATABASE_URL,
    aiUrl: process.env.AI_DATABASE_URL,
    crawlUrl: process.env.CRAWL_DATABASE_URL,
    sourcePoolMax: Number(process.env.SOURCE_DB_POOL_MAX || 5),
    aiPoolMax: Number(process.env.AI_DB_POOL_MAX || 10),
    crawlPoolMax: Number(process.env.CRAWL_DB_POOL_MAX || 5),
    connectionTimeoutMs: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
    crawlConnectionTimeoutMs: Number(process.env.CRAWL_DB_CONNECTION_TIMEOUT_MS || 3000),
    crawlQueryTimeoutMs: Number(process.env.CRAWL_DB_QUERY_TIMEOUT_MS || 3000),
    idleTimeoutMs: Number(process.env.DB_IDLE_TIMEOUT_MS || 10000),
    ssl: process.env.DB_SSL === "true",
  },
  postgresqlUrl: process.env.POSTGRESQL_URL,
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  automation: readSchedulerConfig(process.env),
  aiBudget: { maxRequests: Number(process.env.AI_MAX_REQUESTS_PER_WINDOW || 0), maxTokens: Number(process.env.AI_MAX_TOKENS_PER_WINDOW || 0), windowMs: Number(process.env.AI_BUDGET_WINDOW_MS || 3600000), enforced: process.env.AI_BUDGET_ENFORCED === "true" },
  industryPrefilter: {
    mode: process.env.INDUSTRY_PREFILTER_MODE || "off",
    url: process.env.INDUSTRY_PREFILTER_URL || "http://127.0.0.1:8091",
    timeoutMs: Number(process.env.INDUSTRY_PREFILTER_TIMEOUT_MS || 8000),
  },
};

const store = new confidence.Store(config);

exports.get = (key) => store.get(key);
