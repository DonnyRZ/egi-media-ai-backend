const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");
const { ROLES } = require("../auth/rbac");
const { provisionThenInvite, serializeMembership } = require("../auth/provision-membership");

function createMembershipRouter({ getMembershipStore, getAccessAuditStore } = {}) {
  const router = express.Router();
  const adminScope = requireAuthContext({ tenant: true, company: false, trustedScope: true, permission: "tenant.users.manage", humanOnly: true });
  const companyAdminScope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "company.users.manage", humanOnly: true });
  const auditScope = requireAuthContext({ tenant: true, company: false, trustedScope: true, permission: "audit.read", humanOnly: true });
  router.get("/api/v1/tenant/audit-events", auditScope, asyncHandler(async (req, res) => {
    if (!getAccessAuditStore()?.list) throw Object.assign(new Error("Tenant audit log is not configured"), { code: "NOT_READY", statusCode: 503 });
    const items = await getAccessAuditStore().list({
      tenantId: req.authContext.tenantId,
      companyId: req.query.company_id || null,
      actorId: req.query.actor_id || null,
      action: req.query.action || null,
      outcome: req.query.outcome || null,
      limit: boundedInt(req.query.limit, 100, 200),
    });
    return success(res, { items: items.map(serializeAuditEvent), meta: { limit: boundedInt(req.query.limit, 100, 200), total: items.length } }, req);
  }));
  router.get("/api/v1/tenant/memberships", adminScope, asyncHandler(async (req, res) => {
    const result = await getMembershipStore().list({ tenantId: req.authContext.tenantId, companyId: req.query.company_id, page: positiveInt(req.query.page, 1), limit: boundedInt(req.query.limit, 50, 100) });
    return success(res, { items: result.items.map(serializeMembership), meta: { page: result.page, limit: result.limit, total: result.total } }, req);
  }));
  router.post("/api/v1/tenant/memberships", adminScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    validateInput(req.body);
    const membership = await provisionThenInvite(req.app.locals.localAuthService, getMembershipStore(), {
      userId: req.body.user_id,
      email: req.body.email,
      password: req.body.password,
      fullName: req.body.full_name,
      tenantId: req.authContext.tenantId,
      companyId: req.body.company_id || null,
      role: req.body.role,
    });
    return success(res, { membership: serializeMembership(membership.membership), reused: membership.reused }, req, membership.reused ? 200 : 201);
  }));
  router.patch("/api/v1/tenant/memberships/:membershipId", adminScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const expectedVersion = readVersion(req); if (req.body?.role !== undefined && !ROLES.includes(req.body.role)) throw validationError("role is invalid");
    const result = await getMembershipStore().update({ membershipId: req.params.membershipId, tenantId: req.authContext.tenantId, role: req.body?.role, companyId: req.body?.company_id, status: req.body?.status, expectedVersion });
    if (result.conflict) throw Object.assign(new Error("Membership version conflict"), { code: "VERSION_CONFLICT", statusCode: 409 });
    return success(res, { membership: serializeMembership(result.membership), reused: result.reused }, req);
  }));
  router.delete("/api/v1/tenant/memberships/:membershipId", adminScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getMembershipStore().revoke({ membershipId: req.params.membershipId, tenantId: req.authContext.tenantId, expectedVersion: readVersion(req) });
    if (result.conflict) throw Object.assign(new Error("Membership version conflict"), { code: "VERSION_CONFLICT", statusCode: 409 });
    return success(res, { membership: serializeMembership(result.membership), revoked: true }, req);
  }));
  router.get("/api/v1/company/memberships", companyAdminScope, asyncHandler(async (req, res) => {
    const result = await getMembershipStore().list({ tenantId: req.authContext.tenantId, companyId: req.authContext.companyId, page: positiveInt(req.query.page, 1), limit: boundedInt(req.query.limit, 50, 100) });
    return success(res, { items: result.items.map(serializeMembership), meta: { page: result.page, limit: result.limit, total: result.total, company_id: req.authContext.companyId } }, req);
  }));
  router.post("/api/v1/company/memberships", companyAdminScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    validateInput(req.body, COMPANY_MEMBER_ROLES);
    assertCompanyBodyScope(req);
    const membership = await provisionThenInvite(req.app.locals.localAuthService, getMembershipStore(), {
      userId: req.body.user_id,
      email: req.body.email,
      password: req.body.password,
      fullName: req.body.full_name,
      tenantId: req.authContext.tenantId,
      companyId: req.authContext.companyId,
      role: req.body.role,
    });
    return success(res, { membership: serializeMembership(membership.membership), reused: membership.reused }, req, membership.reused ? 200 : 201);
  }));
  router.patch("/api/v1/company/memberships/:membershipId", companyAdminScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    await requireCompanyMembership(getMembershipStore, req);
    assertCompanyBodyScope(req);
    if (req.body?.status !== undefined) throw validationError("Company admins may only change a member role");
    if (req.body?.role !== undefined && !COMPANY_MEMBER_ROLES.includes(req.body.role)) throw validationError("role is invalid for company access");
    const result = await getMembershipStore().update({ membershipId: req.params.membershipId, tenantId: req.authContext.tenantId, role: req.body?.role, companyId: req.authContext.companyId, expectedVersion: readVersion(req) });
    if (result.conflict) throw Object.assign(new Error("Membership version conflict"), { code: "VERSION_CONFLICT", statusCode: 409 });
    return success(res, { membership: serializeMembership(result.membership), reused: result.reused }, req);
  }));
  router.delete("/api/v1/company/memberships/:membershipId", companyAdminScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    await requireCompanyMembership(getMembershipStore, req);
    const result = await getMembershipStore().revoke({ membershipId: req.params.membershipId, tenantId: req.authContext.tenantId, expectedVersion: readVersion(req) });
    if (result.conflict) throw Object.assign(new Error("Membership version conflict"), { code: "VERSION_CONFLICT", statusCode: 409 });
    return success(res, { membership: serializeMembership(result.membership), revoked: true }, req);
  }));
  router.use((error, req, res, _next) => sendError(res, req, error)); return router;
}
const TENANT_MEMBER_ROLES = Object.freeze(["tenant_admin", "company_admin", "executive", "executive_viewer", "analyst", "reviewer", "viewer"]);
const COMPANY_MEMBER_ROLES = Object.freeze(["company_admin", "executive", "executive_viewer", "analyst", "reviewer", "viewer"]);
function serializeAuditEvent(item) { return { event_id: item.id || item.eventId, actor_id: item.actorId || null, actor_type: item.actorType || "unknown", tenant_id: item.tenantId || null, company_id: item.companyId || null, action: item.action, outcome: item.outcome, request_id: item.requestId || null, metadata: item.metadata || {}, created_at: item.createdAt || item.created_at }; }
function validateInput(body, allowedRoles = TENANT_MEMBER_ROLES) { if (!body || (typeof body.email !== "string" && typeof body.user_id !== "string") || !allowedRoles.includes(body.role)) throw validationError("Membership invite requires a permitted customer role and user identity"); }
function assertCompanyBodyScope(req) { if (Object.hasOwn(req.body || {}, "company_id") && req.body.company_id !== req.authContext.companyId) throw scopeError(); }
async function requireCompanyMembership(getMembershipStore, req) { const membership = await getMembershipStore().get({ membershipId: req.params.membershipId, tenantId: req.authContext.tenantId, companyId: req.authContext.companyId }); if (!membership) throw scopeError(); return membership; }
function readVersion(req) { const value = req.get("If-Match") || req.body?.version; const version = Number(value); if (!Number.isInteger(version) || version < 1) throw Object.assign(new Error("A positive membership version is required"), { code: "VERSION_CONFLICT", statusCode: 409 }); return version; }
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, validationError("Idempotency-Key header must be 16 to 255 characters")); return next(); }
function validationError(message) { return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 }); }
function scopeError() { return Object.assign(new Error("Membership is outside the active company scope"), { code: "FORBIDDEN", statusCode: 403 }); }
function positiveInt(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function boundedInt(value, fallback, max) { return Math.min(positiveInt(value, fallback), max); }
function success(res, data, req, statusCode = 200) { return res.status(statusCode).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createMembershipRouter };
