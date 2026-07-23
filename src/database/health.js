async function checkDatabaseHealth(runtime) {
  const checks = {};
  if (!runtime?.source?.healthCheck || !runtime?.ai?.healthCheck) {
    return { healthy: false, checks: { database_runtime: "not_configured" } };
  }

  try {
    checks.source_database = (await runtime.source.healthCheck()) ? "ok" : "failed";
  } catch (_error) {
    checks.source_database = "failed";
  }
  try {
    checks.ai_database = (await runtime.ai.healthCheck()) ? "ok" : "failed";
  } catch (_error) {
    checks.ai_database = "failed";
  }
  return {
    healthy: checks.source_database === "ok" && checks.ai_database === "ok",
    checks,
  };
}

module.exports = { checkDatabaseHealth };
