const jwt = require("jsonwebtoken");
const config = require("../config/global_config");

class AuthContextError extends Error {
  constructor(message, { code = "UNAUTHORIZED", statusCode = 401 } = {}) {
    super(message);
    this.name = "AuthContextError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function extractBearerToken(header) {
  if (typeof header !== "string") return null;
  const [scheme, token] = header.trim().split(/\s+/);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

const LOCAL_UI_DUMMY_TOKEN = "dummy-bearer-token-for-local-ui";

function defaultVerifyToken(token) {
  // Local UI preview: egi-media-ai-frontend login uses a non-JWT placeholder until real auth is wired.
  if (config.get("/env") !== "production" && process.env.AI_LOCAL_PREVIEW_AUTH === "true" && token === LOCAL_UI_DUMMY_TOKEN) {
    return {
      id: "dummy-actor",
      email: "executive@example.com",
      full_name: "Executive User",
      role: "human_reviewer",
      actor_type: "human",
      membership_id: "dummy-membership",
      tenant_id: "dummy-tenant",
      company_id: "company-a",
      authorized_companies: ["company-a"],
    };
  }
  const secrets = [config.get("/auth/accessTokenSecret"), config.get("/auth/serviceAuthSecret")].filter(Boolean);
  if (!secrets.length) throw new AuthContextError("Authentication verifier is not configured", { code: "AUTHENTICATION_UNAVAILABLE", statusCode: 503 });
  for (const secret of secrets) {
    try {
      const payload = jwt.verify(token, secret);
      if (secret === config.get("/auth/serviceAuthSecret") && !["service", "ai_worker"].includes(payload?.actor_type) && payload?.role !== "ai_worker") throw new AuthContextError("Service token actor type is invalid");
      return payload;
    } catch (_error) { /* try the next configured identity authority */ }
  }
  throw new AuthContextError("Access token is invalid or expired");
}

function normalizeActor(payload) {
  const actorId = payload?.id || payload?.sub;
  if (typeof actorId !== "string" || !actorId) throw new AuthContextError("Access token does not contain actor identity");
  return {
    actorId,
    actorType: payload.actor_type || payload.actorType || (payload.role === "ai_worker" ? "ai_worker" : "human"),
    email: typeof payload.email === "string" ? payload.email : null,
    fullName: typeof payload.full_name === "string" ? payload.full_name : null,
    role: typeof payload.role === "string" ? payload.role : null,
    ...(typeof payload.membership_id === "string" ? { membershipId: payload.membership_id } : {}),
  };
}

function readScope(payload, req) {
  const claimTenantId = payload?.tenant_id || payload?.tenantId || null;
  const claimCompanyId = payload?.company_id || payload?.companyId || null;
  const headerTenantId = req.get("X-Tenant-Id") || null;
  const headerCompanyId = req.get("X-Company-Id") || null;
  return {
    tenantId: claimTenantId || headerTenantId,
    companyId: claimCompanyId || headerCompanyId,
    source: claimTenantId || claimCompanyId ? "jwt_claims" : (headerTenantId || headerCompanyId ? "request_headers" : "none"),
    trusted: Boolean(claimTenantId && claimCompanyId),
  };
}

function createAuthContextMiddleware({ verifyToken = defaultVerifyToken, allowAnonymous = true } = {}) {
  return (req, _res, next) => {
    const token = extractBearerToken(req.get("Authorization"));
    if (!token) {
      if (!allowAnonymous) return next(new AuthContextError("Authentication is required"));
      req.authContext = { actor: null, tenantId: null, companyId: null, scopeSource: "none", scopeTrusted: false };
      req.user = undefined;
      return next();
    }
    try {
      const payload = verifyToken(token);
      const actor = normalizeActor(payload);
      const scope = readScope(payload, req);
      req.authContext = { actor, tenantId: scope.tenantId, companyId: scope.companyId, scopeSource: scope.source, scopeTrusted: scope.trusted };
      if (Array.isArray(payload?.authorized_companies)) req.authContext.authorizedCompanies = payload.authorized_companies;
      req.user = actor;
      return next();
    } catch (error) {
      return next(error instanceof AuthContextError ? error : new AuthContextError("Access token is invalid or expired"));
    }
  };
}

function requireAuthContext({ tenant = true, company = true, trustedScope = false, permission = null, humanOnly = false, platform = false } = {}) {
  return (req, _res, next) => {
    const context = req.authContext;
    if (!context?.actor) return next(new AuthContextError("Authentication is required"));
    if (tenant && !context.tenantId) return next(new AuthContextError("Tenant context is required", { code: "TENANT_CONTEXT_REQUIRED", statusCode: 400 }));
    if (company && !context.companyId) return next(new AuthContextError("Company context is required", { code: "COMPANY_CONTEXT_REQUIRED", statusCode: 400 }));
    if (trustedScope && !context.scopeTrusted) return next(new AuthContextError("Trusted tenant and company context is required", { code: "SCOPE_CONTEXT_UNTRUSTED", statusCode: 403 }));
    const authorizationService = req.app?.locals?.authorizationService;
    if (!authorizationService?.resolve) return next();
    const resolution = platform
      ? authorizationService.authorizePlatform(context, permission, { humanOnly })
      : (permission ? authorizationService.authorize(context, permission, { humanOnly }) : authorizationService.resolve(context));
    return Promise.resolve(resolution).then((resolved) => {
      req.authContext = resolved;
      req.user = resolved.actor;
      next();
    }).catch(next);
  };
}

module.exports = { AuthContextError, extractBearerToken, normalizeActor, createAuthContextMiddleware, requireAuthContext };
