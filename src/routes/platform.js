const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");
const { validateTenantStatus } = require("../auth/tenant.store");
const { provisionThenInvite, serializeMembership } = require("../auth/provision-membership");
const { getAllowedChannelIds, mergeAllowedNewsChannels } = require("../auth/tenant-news-policy");

function createPlatformRouter({ getTenantStore, getCompanyStore, getMembershipStore, getAccessAuditStore, getPlatformHealth } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: false, company: false, permission: "platform.tenants.manage", humanOnly: true, platform: true });
  const auditScope = requireAuthContext({ tenant: false, company: false, permission: "platform.audit.read", humanOnly: true, platform: true });
  router.get("/api/v1/platform/health", scope, asyncHandler(async (req, res) => {
    if (typeof getPlatformHealth !== "function") throw Object.assign(new Error("Platform health is not configured"), { code: "NOT_READY", statusCode: 503 });
    return success(res, await getPlatformHealth(), req);
  }));
  router.get("/api/v1/platform/audit-events", auditScope, asyncHandler(async (req, res) => {
    if (!getAccessAuditStore()?.list) throw Object.assign(new Error("Platform audit log is not configured"), { code: "NOT_READY", statusCode: 503 });
    const items = await getAccessAuditStore().list({ tenantId: req.query.tenant_id || null, companyId: req.query.company_id || null, actorId: req.query.actor_id || null, action: req.query.action || null, outcome: req.query.outcome || null, limit: boundedInt(req.query.limit, 100, 200) });
    return success(res, { items: items.map(serializeAuditEvent), meta: { limit: boundedInt(req.query.limit, 100, 200), total: items.length } }, req);
  }));
  router.get("/api/v1/platform/tenants", scope, asyncHandler(async (req, res) => {
    const result = await getTenantStore().list({ page: positiveInt(req.query.page, 1), limit: boundedInt(req.query.limit, 50, 100), status: req.query.status || null, search: req.query.q || req.query.search || null });
    return success(res, { items: result.items.map(serialize), meta: { page: result.page, limit: result.limit, total: result.total, counts: result.counts || null } }, req);
  }));
  router.post("/api/v1/platform/tenants", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (typeof req.body?.name !== "string" || !req.body.name.trim() || req.body.name.length > 255) throw validationError("Tenant name is required");
    const metadata = mergeAllowedNewsChannels({}, req.body.metadata, req.body.allowed_news_channel_ids) ?? req.body.metadata ?? {};
    const result = await getTenantStore().create({ tenantId: req.body.tenant_id, name: req.body.name.trim(), legalName: req.body.legal_name, timezone: req.body.timezone, defaultLocale: req.body.default_locale, status: req.body.status || "pending", metadata });
    return success(res, { tenant: serialize(result.tenant), reused: result.reused }, req, result.reused ? 200 : 201);
  }));
  router.post("/api/v1/platform/tenants/bulk-lifecycle", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const status = req.body?.status;
    if (status !== undefined) validateTenantStatus(status);
    if (!status) throw validationError("Lifecycle status is required");
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if ((status === "suspended" || status === "archived") && !reason) throw validationError("A reason is required for this lifecycle change");
    if (reason.length > 500) throw validationError("Lifecycle reason must be 500 characters or fewer");
    const tenantIds = normalizeIds(req.body?.tenant_ids);
    const filter = req.body?.filter && typeof req.body.filter === "object" ? req.body.filter : null;
    if (!tenantIds.length && !filter) throw validationError("Provide tenant_ids or a workspace filter");
    if (tenantIds.length && filter) throw validationError("Provide tenant_ids or a workspace filter, not both");
    if (tenantIds.length > 500) throw validationError("A bulk action can include at most 500 workspaces");
    const filterStatus = filter?.status || null;
    if (filterStatus) validateTenantStatus(filterStatus);
    const search = typeof filter?.q === "string" ? filter.q.trim() : null;
    if (filter && !filterStatus && !search) throw validationError("A workspace filter must include a status or search term");
    const result = await getTenantStore().bulkUpdate({ tenantIds, status, filterStatus, search });
    for (const previous of result.previousStatuses || []) {
      if (previous.status === status) continue;
      await getAccessAuditStore()?.record?.({
        actorId: req.authContext?.actor?.actorId,
        actorType: req.authContext?.actor?.actorType || "human",
        tenantId: previous.tenantId,
        action: "tenant.lifecycle.change",
        outcome: "allowed",
        metadata: { previousStatus: previous.status, nextStatus: status, reason: reason || null, bulk: true },
      });
    }
    return success(res, { tenants: result.tenants.map(serialize), updated_count: result.tenants.length, lifecycle_changed: true }, req);
  }));
  router.patch("/api/v1/platform/tenants/:tenantId", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    const status = req.body?.status;
    if (status !== undefined) validateTenantStatus(status);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length > 500) throw validationError("Lifecycle reason must be 500 characters or fewer");
    const current = await getTenantStore().get({ tenantId: req.params.tenantId });
    if (!current) throw Object.assign(new Error("Tenant was not found"), { code: "NOT_FOUND", statusCode: 404 });
    const metadata = mergeAllowedNewsChannels(current.metadata, req.body?.metadata, req.body?.allowed_news_channel_ids);
    const result = await getTenantStore().update({ tenantId: req.params.tenantId, name: req.body?.name, legalName: req.body?.legal_name, status, timezone: req.body?.timezone, defaultLocale: req.body?.default_locale, metadata });
    if (status !== undefined && result.previousStatus !== status) {
      await getAccessAuditStore()?.record?.({
        actorId: req.authContext?.actor?.actorId,
        actorType: req.authContext?.actor?.actorType || "human",
        tenantId: req.params.tenantId,
        action: "tenant.lifecycle.change",
        outcome: "allowed",
        metadata: { previousStatus: result.previousStatus, nextStatus: status, reason: reason || null },
      });
    }
    return success(res, { tenant: serialize(result.tenant), previous_status: result.previousStatus, lifecycle_changed: status !== undefined && result.previousStatus !== status }, req);
  }));
  router.get("/api/v1/platform/tenants/:tenantId/companies", scope, asyncHandler(async (req, res) => {
    const result = await getCompanyStore().list({ tenantId: req.params.tenantId, page: positiveInt(req.query.page, 1), limit: boundedInt(req.query.limit, 50, 100) });
    return success(res, { items: result.items.map(serializeCompany), meta: { page: result.page, limit: result.limit, total: result.total } }, req);
  }));
  router.post("/api/v1/platform/tenants/:tenantId/companies", scope, requireIdempotencyKey, asyncHandler(async (req, res) => {
    if (typeof req.body?.name !== "string" || !req.body.name.trim() || req.body.name.length > 255) throw validationError("Company name is required");
    const result = await getCompanyStore().create({ tenantId: req.params.tenantId, companyId: req.body.company_id, name: req.body.name.trim(), legalName: req.body.legal_name, timezone: req.body.timezone, locale: req.body.locale, status: req.body.status || "active", metadata: req.body.metadata });
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
    if (typeof req.body?.company_id !== "string" || !req.body.company_id.trim()) throw validationError("Owner company is required");
    const result = await provisionThenInvite(req.app.locals.localAuthService, getMembershipStore(), {
      userId: req.body.user_id,
      email: req.body.email,
      password: req.body.password,
      fullName: req.body.full_name,
      tenantId: req.params.tenantId,
      companyId: req.body.company_id.trim(),
      role: "tenant_owner",
    });
    return success(res, { membership: serializeMembership(result.membership), reused: result.reused }, req, result.reused ? 200 : 201);
  }));
  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}

function serialize(item) { return { tenant_id: item.tenantId, name: item.name, legal_name: item.legalName || null, status: item.status, timezone: item.timezone || "UTC", default_locale: item.defaultLocale || "id", metadata: item.metadata || {}, allowed_news_channel_ids: getAllowedChannelIds(item), created_at: item.createdAt, updated_at: item.updatedAt }; }
function serializeCompany(item) { return { company_id: item.companyId, tenant_id: item.tenantId, name: item.name, legal_name: item.legalName || null, status: item.status, timezone: item.timezone || null, locale: item.locale || null, metadata: item.metadata || {}, created_at: item.createdAt, updated_at: item.updatedAt }; }
function serializeAuditEvent(item) { return { event_id: item.id || item.eventId, actor_id: item.actorId || null, actor_type: item.actorType || "unknown", tenant_id: item.tenantId || null, company_id: item.companyId || null, action: item.action, outcome: item.outcome, request_id: item.requestId || null, metadata: item.metadata || {}, created_at: item.createdAt || item.created_at }; }
function positiveInt(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function boundedInt(value, fallback, max) { return Math.min(positiveInt(value, fallback), max); }
function normalizeIds(value) { return [...new Set((Array.isArray(value) ? value : []).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]; }
function validationError(message) { return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 }); }
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, validationError("Idempotency-Key header must be 16 to 255 characters")); return next(); }
function success(res, data, req, statusCode = 200) { return res.status(statusCode).json({ success: true, data, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); }
function asyncHandler(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

module.exports = { createPlatformRouter };
