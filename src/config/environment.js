const Joi = require("joi");

const productionSchema = Joi.object({
  APP_ENV: Joi.string().valid("production").required(), APP_HOST: Joi.alternatives().try(Joi.string().ip(), Joi.string().hostname()).required(), APP_PORT: Joi.number().integer().min(1).max(65535).required(), CORS_ORIGINS: Joi.string().min(1).required(),
  CMS_BASE_URL: Joi.string().uri({ scheme: ["http", "https"] }).required(), PORTAL_BASE_URL: Joi.string().uri({ scheme: ["http", "https"] }).required(),
  AUTH_ACCESS_TOKEN_SECRET: Joi.string().min(32).required(), OPENAI_API_KEY: Joi.string().min(1).required(), OPENAI_MINI_MODEL: Joi.string().min(1).required(), OPENAI_NANO_MODEL: Joi.string().min(1).required(),
  SOURCE_DATABASE_URL: Joi.string().uri({ scheme: ["postgres", "postgresql"] }).required(), AI_DATABASE_URL: Joi.string().uri({ scheme: ["postgres", "postgresql"] }).required(), CRAWL_DATABASE_URL: Joi.string().uri({ scheme: ["postgres", "postgresql"] }).required(),
  EMAIL_TRANSPORT: Joi.string().valid("smtp").required(), EMAIL_SMTP_HOST: Joi.string().min(1).required(), EMAIL_SMTP_USER: Joi.string().email().required(), EMAIL_SMTP_APP_PASSWORD: Joi.string().min(1).required(), EMAIL_FROM_ADDRESS: Joi.string().email().required(),
}).unknown(true);

const schema = Joi.object({
  SOURCE_DATABASE_URL: Joi.string().uri({ scheme: ["postgres", "postgresql"] }).required(),
  AI_DATABASE_URL: Joi.string().uri({ scheme: ["postgres", "postgresql"] }).required(),
  CRAWL_DATABASE_URL: Joi.string().uri({ scheme: ["postgres", "postgresql"] }).optional(),
  SOURCE_DB_POOL_MAX: Joi.number().integer().min(1).max(50).default(5),
  AI_DB_POOL_MAX: Joi.number().integer().min(1).max(50).default(10),
  CRAWL_DB_POOL_MAX: Joi.number().integer().min(1).max(50).default(5),
  DB_CONNECTION_TIMEOUT_MS: Joi.number().integer().min(250).max(120000).default(5000),
  CRAWL_DB_CONNECTION_TIMEOUT_MS: Joi.number().integer().min(250).max(30000).default(3000),
  CRAWL_DB_QUERY_TIMEOUT_MS: Joi.number().integer().min(250).max(30000).default(3000),
  DB_IDLE_TIMEOUT_MS: Joi.number().integer().min(0).max(600000).default(10000),
  DB_SSL: Joi.boolean().truthy("true").falsy("false").default(false),
}).unknown(true);

function validateEnvironment(env = process.env) {
  const { error, value } = schema.validate(env, { abortEarly: false, convert: true });
  if (error) {
    throw new Error(`Invalid database environment: ${error.details.map((d) => d.message).join("; ")}`);
  }
  return value;
}

function withListenPort(env) {
  return { ...env, APP_PORT: env.APP_PORT || env.PORT };
}

function validateProductionEnvironment(env = process.env) {
  const { error, value } = productionSchema.validate(withListenPort(env), { abortEarly: false, convert: true });
  if (error) throw new Error(`Invalid production environment: ${error.details.map((d) => d.message).join("; ")}`);
  return value;
}

module.exports = { validateEnvironment, validateProductionEnvironment };
