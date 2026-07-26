const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createPlatformRouter({ getTenantStore, getCompanyStore, getMembershipStore } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: false, company: false, permission: "platform.tenants.manage", humanOnly: true, platform: true });
  router.get("/api/v1/platform/tenants", scope, asyncHandler(async (req, res) => {
    const result = await getTenantStore().list({ page: positiveInt(req.query.page, 1), limit: boundedInt(req.query.limit, 50, 100) });
    return success(res, { items: result.items.map(serialize), meta: { page: result.page, limit: result.limit, total: result.total } }, req);
  }));
  router.post("/api/v1/platform/tenants", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (typeof req.body?.name !== "string" || !req.body.name.trim() || req.body.name.length > 255) throw validationError("Tenant name is required");
    const result = await getTenantStore().create({ tenantId: req.body.tenant_id, name: req.body.name.trim(), legalName: req.body.legal_name, timezone: req.body.timezone, defaultLocale: req.body.default_locale, status: req.body.status || "pending", metadata: req.body.metadata });
    return success(res, { tenant: serialize(result.tenant), reused: result.reused }, req, result.reused ? 200 : 201);
  }));
  router.patch("/api/v1/platform/tenants/:tenantId", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getTenantStore().update({ tenantId: req.params.tenantId, name: req.body?.name, legalName: req.body?.legal_name, status: req.body?.status, timezone: req.body?.timezone, defaultLocale: req.body?.default_locale, metadata: req.body?.metadata });
    return success(res, { tenant: serialize(result.tenant) }, req);
  }));
  router.get("/api/v1/platform/tenants/:tenantId/companies", scope, asyncHandler(async (req, res) => {
    const result = await getCompanyStore().list({ tenantId: req.params.tenantId, page: positiveInt(req.query.page, 1), limit: boundedInt(req.query.limit, 50, 100) });
    return success(res, { items: result.items.map(serializeCompany), meta: { page: result.page, limit: result.limit, total: result.total } }, req);
  }));
  router.post("/api/v1/platform/tenants/:tenantId/companies", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (typeof req.body?.name !== "string" || !req.body.name.trim() || req.body.name.length > 255) throw validationError("Company name is required");
    const result = await getCompanyStore().create({ tenantId: req.params.tenantId, companyId: req.body.company_id, name: req.body.name.trim(), legalName: req.body.legal_name, timezone: req.body.timezone, locale: req.body.locale, status: req.body.status || "pending", metadata: req.body.metadata });
    return success(res, { company: serializeCompany(result.company), reused: result.reused }, req, result.reused ? 200 : 201);
  }));
  router.patch("/api/v1/platform/tenants/:tenantId/companies/:companyId", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const result = await getCompanyStore().update({ tenantId: req.params.tenantId, companyId: req.params.companyId, name: req.body?.name, legalName: req.body?.legal_name, status: req.body?.status, timezone: req.body?.timezone, locale: req.body?.locale, metadata: req.body?.metadata });
    return success(res, { company: serializeCompany(result.company) }, req);
  }));
  router.get("/api/v1/platform/tenants/:tenantId/memberships", scope, asyncHandler(async (req, res) => {
    const result = await getMembershipStore().list({ tenantId: req.params.tenantId, page: positiveInt(req.query.page, 1), limit: boundedInt(req.query.limit, 50, 100) });
    return success(res, { items: result.items.map(serializeMembership), meta: { page: result.page, limit: result.limit, total: result.total } }, req);
  }));
  router.post("/api/v1/platform/tenants/:tenantId/owner", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (typeof req.body?.email !== "string" || !req.body.email.includes("@")) throw validationError("Owner email is required");
    const result = await getMembershipStore().invite({ userId: req.body.user_id, email: req.body.email, fullName: req.body.full_name, tenantId: req.params.tenantId, companyId: req.body.company_id || null, role: "tenant_owner" });
    return success(res, { membership: serializeMembership(result.membership), reused: result.reused }, req, result.reused ? 200 : 201);
  }));
  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}

function serialize(item) { return { tenant_id: item.tenantId, name: item.name, legal_name: item.legalName || null, status: item.status, timezone: item.timezone || "UTC", default_locale: item.defaultLocale || "id", metadata: item.metadata || {}, created_at: item.createdAt, updated_at: item.updatedAt }; }
function serializeCompany(item) { return { company_id: item.companyId, tenant_id: item.tenantId, name: item.name, legal_name: item.legalName || null, status: item.status, timezone: item.timezone || null, locale: item.locale || null, metadata: item.metadata || {}, created_at: item.createdAt, updated_at: item.updatedAt }; }
function serializeMembership(item) { return { membership_id: item.membershipId, user_id: item.userId, tenant_id: item.tenantId, company_id: item.companyId, role: item.role, status: item.status, version: item.version, permissions: item.permissions || [] }; }
function positiveInt(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function boundedInt(value, fallback, max) { return Math.min(positiveInt(value, fallback), max); }
function validationError(message) { return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 }); }
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, validationError("Idempotency-Key header must be 16 to 255 characters")); return next(); }
function success(res, data, req, statusCode = 200) { return res.status(statusCode).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

module.exports = { createPlatformRouter };
