require("dotenv").config();
const confidence = require("confidence");

const config = {
  host: process.env.APP_HOST || "localhost",
  env: process.env.APP_ENV || "development",
  port: Number(process.env.APP_PORT || 5003),
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
    miniModel: process.env.OPENAI_MINI_MODEL,
    nanoModel: process.env.OPENAI_NANO_MODEL,
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 30000),
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
  postgresqlUrl: process.env.POSTGRESQL_URL,
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
};

const store = new confidence.Store(config);

exports.get = (key) => store.get(key);
