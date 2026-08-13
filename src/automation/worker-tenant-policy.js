/**
 * Worker tenant scope policy.
 *
 * Incident context: empty AI_WORKER_TENANT_IDS meant "process all tenants",
 * so eval-* backlog drained OpenAI even with automatic intake off.
 *
 * Rules:
 * - Production + workers on → AI_WORKER_TENANT_IDS required (fail closed).
 * - eval-* tenants never processed unless AI_ALLOW_EVAL_TENANTS=true.
 * - Empty allowlist array means claim nothing (never "all tenants").
 * - null tenantIds (dev only) means all non-eval tenants.
 */
function parseCsvIds(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isEvalTenantId(tenantId) {
  const id = String(tenantId || "");
  if (!id) return false;
  return id.startsWith("eval-") || id.includes("eval-tenant");
}

function policyError(message) {
  const error = new Error(message);
  error.code = "AI_WORKER_TENANT_POLICY_INVALID";
  error.statusCode = 503;
  return error;
}

function resolveWorkerTenantPolicy(env = process.env) {
  const appEnv = env.APP_ENV || "development";
  const isProduction = appEnv === "production";
  const workersEnabled = String(env.AI_WORKERS_ENABLED ?? "true") !== "false";
  const allowEval = env.AI_ALLOW_EVAL_TENANTS === "true";
  const rawAllowlist = parseCsvIds(env.AI_WORKER_TENANT_IDS);
  const tenantIds = rawAllowlist.filter((id) => allowEval || !isEvalTenantId(id));

  if (workersEnabled && isProduction && rawAllowlist.length === 0) {
    throw policyError(
      "AI_WORKER_TENANT_IDS must be set in production when AI_WORKERS_ENABLED=true (fail-closed; empty allowlist no longer means all tenants)"
    );
  }

  if (workersEnabled && isProduction) {
    const enforced = env.AI_BUDGET_ENFORCED === "true";
    const maxRequests = Number(env.AI_MAX_REQUESTS_PER_WINDOW || 0);
    const maxTokens = Number(env.AI_MAX_TOKENS_PER_WINDOW || 0);
    if (!enforced || (maxRequests <= 0 && maxTokens <= 0)) {
      throw policyError(
        "Production workers require AI_BUDGET_ENFORCED=true and a nonzero AI_MAX_REQUESTS_PER_WINDOW and/or AI_MAX_TOKENS_PER_WINDOW"
      );
    }
  }

  // Production always uses an allowlist (possibly empty after eval filter → claim nothing).
  // Development may use null (= all non-eval) when allowlist unset.
  const claimTenantIds = rawAllowlist.length > 0 || isProduction ? tenantIds : null;

  return {
    appEnv,
    isProduction,
    workersEnabled,
    allowEval,
    excludeEval: !allowEval,
    rawAllowlist,
    tenantIds: claimTenantIds,
    isTenantAllowed(tenantId) {
      if (!allowEval && isEvalTenantId(tenantId)) return false;
      if (claimTenantIds == null) return true;
      return claimTenantIds.includes(tenantId);
    },
  };
}

function filterEligibleScopes(scopes, policy) {
  const list = Array.isArray(scopes) ? scopes : [];
  if (!policy?.isTenantAllowed) return list;
  return list.filter((scope) => policy.isTenantAllowed(scope?.tenantId));
}

module.exports = {
  isEvalTenantId,
  parseCsvIds,
  resolveWorkerTenantPolicy,
  filterEligibleScopes,
};
