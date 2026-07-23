const { validateEnvironment } = require("../config/environment");
const { sendError } = require("./error-contract");
const { checkDatabaseHealth } = require("../database/health");

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createHealthHandlers({ getDatabaseRuntime, env = process.env } = {}) {
  const getRuntime = getDatabaseRuntime || (() => null);

  function live(_req, res) {
    return res.status(200).json({
      success: true,
      data: { status: "alive", service: "egi-media-ai-backend" },
    });
  }

  async function ready(req, res) {
    const checks = {};
    try {
      validateEnvironment(env);
      checks.environment = "ok";
    } catch (error) {
      checks.environment = "failed";
      return sendError(res, req, Object.assign(new Error("Environment validation failed"), { code: "NOT_READY", statusCode: 503 }), { checks });
    }

    const runtime = getRuntime();
    if (runtime) {
      const database = await checkDatabaseHealth(runtime);
      Object.assign(checks, database.checks);
      if (!database.healthy) {
        checks.database = "failed";
        return sendError(res, req, Object.assign(new Error("Database readiness check failed"), { code: "NOT_READY", statusCode: 503 }), { checks });
      }
    }

    return res.status(200).json({ success: true, data: { status: "ready" }, meta: { checks } });
  }

  return { live, ready };
}

module.exports = { createHealthHandlers };
