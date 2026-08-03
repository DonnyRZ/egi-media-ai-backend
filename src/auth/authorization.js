const { AuthContextError } = require("./auth-context");
const { permissionsForRole, isRole } = require("./rbac");

const LEGACY_ROLE_MAP = Object.freeze({ human_reviewer: "analyst" });

class AuthorizationService {
  constructor({ membershipStore = null, platformStore = null, tenantStore = null, strictMembership = false, auditStore = null, logger = null } = {}) {
    this.membershipStore = membershipStore;
    this.platformStore = platformStore;
    this.tenantStore = tenantStore;
    this.strictMembership = strictMembership;
    this.auditStore = auditStore;
    this.logger = logger || { info() {}, warn() {}, error() {} };
  }

  async resolve(context) {
    const actor = context?.actor;
    if (!actor?.actorId || !context?.tenantId) throw new AuthContextError("Authentication and tenant context are required");
    if (this.tenantStore?.get) {
      const tenant = await this.tenantStore.get({ tenantId: context.tenantId });
      if (tenant && tenant.status !== "active") {
        await this._audit(context, "scope.resolve", "denied", { reason: "tenant_status", status: tenant.status });
        const label = tenant.status === "archived" ? "archived" : "temporarily suspended";
        throw new AuthContextError(`This customer workspace is ${label}`, { code: "TENANT_NOT_ACTIVE", statusCode: 403 });
      }
      if (!tenant && this.strictMembership) {
        await this._audit(context, "scope.resolve", "denied", { reason: "tenant_not_found" });
        throw new AuthContextError("Customer workspace was not found", { code: "TENANT_NOT_FOUND", statusCode: 403 });
      }
    }
    let membership = null;
    if (this.membershipStore?.resolve) {
      try { membership = await this.membershipStore.resolve({ userId: actor.actorId, tenantId: context.tenantId, companyId: context.companyId, actorType: actor.actorType }); } catch (error) { if (this.strictMembership) { await this._audit(context, "scope.resolve", "denied", { code: error.code }); throw error; } }
    }
    if (!membership && !this.strictMembership) {
      const role = LEGACY_ROLE_MAP[actor.role] || actor.role;
      if (isRole(role)) membership = { membershipId: actor.membershipId || null, userId: actor.actorId, tenantId: context.tenantId, companyId: context.companyId || null, role, status: "active", permissions: [...permissionsForRole(role)] };
    }
    if (!membership) { await this._audit(context, "scope.resolve", "denied"); throw new AuthContextError("Actor is not a member of this tenant/company", { code: "FORBIDDEN", statusCode: 403 }); }
    if (membership.companyId && context.companyId && membership.companyId !== context.companyId) { await this._audit(context, "scope.resolve", "denied"); throw new AuthContextError("Actor is not authorized for this company", { code: "FORBIDDEN", statusCode: 403 }); }
    const resolved = { ...context, membership, role: membership.role, permissions: new Set(membership.permissions || []) };
    return resolved;
  }

  async authorize(context, permission, { humanOnly = false } = {}) {
    const resolved = await this.resolve(context);
    if (humanOnly && resolved.actor.actorType !== "human") { await this._audit(resolved, permission, "denied", { reason: "human_only" }); throw new AuthContextError("This action requires a human actor", { code: "FORBIDDEN", statusCode: 403 }); }
    if (!resolved.permissions.has(permission)) { await this._audit(resolved, permission, "denied", { reason: "permission" }); throw new AuthContextError("Actor does not have the required permission", { code: "FORBIDDEN", statusCode: 403 }); }
    await this._audit(resolved, permission, "allowed");
    return resolved;
  }

  async authorizePlatform(context, permission, { humanOnly = false } = {}) {
    const actor = context?.actor;
    if (!actor?.actorId) throw new AuthContextError("Authentication is required");
    const operator = await this.platformStore?.resolve?.({ userId: actor.actorId });
    if (!operator || operator.role !== "platform_superadmin") {
      await this._audit(context, permission, "denied", { reason: "platform_role" });
      throw new AuthContextError("Platform administrator access is required", { code: "FORBIDDEN", statusCode: 403 });
    }
    if (humanOnly && actor.actorType !== "human") {
      await this._audit(context, permission, "denied", { reason: "human_only" });
      throw new AuthContextError("This action requires a human actor", { code: "FORBIDDEN", statusCode: 403 });
    }
    if (!permissionsForRole(operator.role).has(permission)) {
      await this._audit(context, permission, "denied", { reason: "permission" });
      throw new AuthContextError("Actor does not have the required permission", { code: "FORBIDDEN", statusCode: 403 });
    }
    const resolved = { ...context, role: operator.role, platformOperator: operator, permissions: new Set(permissionsForRole(operator.role)) };
    await this._audit(resolved, permission, "allowed");
    return resolved;
  }

  async _audit(context, action, outcome, metadata = {}) {
    this.logger[outcome === "allowed" ? "info" : "warn"]("authorization_evaluated", { actorType: context?.actor?.actorType || null, tenantId: context?.tenantId || null, companyId: context?.companyId || null, action, outcome, reason: metadata.reason || null, errorCode: metadata.code || null });
    if (!this.auditStore?.record) return;
    try { await this.auditStore.record({ actorId: context?.actor?.actorId, actorType: context?.actor?.actorType, tenantId: context?.tenantId, companyId: context?.companyId, action, outcome, metadata }); } catch (error) { this.logger.error("access_audit_persist_failed", { action, outcome, error }); }
  }
}

function requirePermission(permission, options = {}) {
  if (!permission) throw new TypeError("Permission is required");
  return (req, _res, next) => {
    const service = req.app?.locals?.authorizationService;
    if (!service) return next(new AuthContextError("Authorization service is not configured", { code: "AUTHENTICATION_UNAVAILABLE", statusCode: 503 }));
    Promise.resolve(service.authorize(req.authContext, permission, options)).then((resolved) => {
      req.authContext = resolved;
      req.user = resolved.actor;
      next();
    }).catch(next);
  };
}

module.exports = { AuthorizationService, requirePermission, LEGACY_ROLE_MAP };
