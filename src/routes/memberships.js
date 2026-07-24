const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");
const { ROLES } = require("../auth/rbac");

function createMembershipRouter({ getMembershipStore } = {}) {
  const router = express.Router();
  const adminScope = requireAuthContext({ tenant: true, company: false, trustedScope: true, permission: "tenant.users.manage", humanOnly: true });
  router.get("/api/v1/tenant/memberships", adminScope, asyncHandler(async (req, res) => {
    const result = await getMembershipStore().list({ tenantId: req.authContext.tenantId, companyId: req.query.company_id, page: positiveInt(req.query.page, 1), limit: boundedInt(req.query.limit, 50, 100) });
    return success(res, { items: result.items.map(serializeMembership), meta: { page: result.page, limit: result.limit, total: result.total } }, req);
  }));
  router.post("/api/v1/tenant/memberships", adminScope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    validateInput(req.body); const membership = await getMembershipStore().invite({ userId: req.body.user_id, email: req.body.email, fullName: req.body.full_name, tenantId: req.authContext.tenantId, companyId: req.body.company_id || null, role: req.body.role });
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
  router.use((error, req, res, _next) => sendError(res, req, error)); return router;
}
function serializeMembership(item) { return { membership_id: item.membershipId, user_id: item.userId, tenant_id: item.tenantId, company_id: item.companyId, role: item.role, status: item.status, version: item.version, permissions: item.permissions || [] }; }
function validateInput(body) { if (!body || (typeof body.email !== "string" && typeof body.user_id !== "string") || !ROLES.includes(body.role) || ["platform_superadmin", "ai_worker"].includes(body.role)) throw validationError("Membership invite requires a customer role and user identity"); }
function readVersion(req) { const value = req.get("If-Match") || req.body?.version; const version = Number(value); if (!Number.isInteger(version) || version < 1) throw Object.assign(new Error("A positive membership version is required"), { code: "VERSION_CONFLICT", statusCode: 409 }); return version; }
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, validationError("Idempotency-Key header must be 16 to 255 characters")); return next(); }
function validationError(message) { return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 }); }
function positiveInt(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function boundedInt(value, fallback, max) { return Math.min(positiveInt(value, fallback), max); }
function success(res, data, req, statusCode = 200) { return res.status(statusCode).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
module.exports = { createMembershipRouter };
