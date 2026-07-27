const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");
const { resolveCompanyLanguage, normalizeLanguagePreference } = require("../language/company-language");
const { enrichCompanyOptions } = require("../auth/company-options");

function createCompanyRouter({ getCompanyStore } = {}) {
  const router = express.Router();
  // Company enumeration is tenant-scoped. Company-scoped business endpoints
  // still require a trusted active company context.
  const scope = requireAuthContext({ tenant: true, company: false, trustedScope: false });
  router.get("/api/v1/companies", scope, async (req, res, next) => {
    try {
    const memberships = await req.app.locals.membershipStore?.list?.({ tenantId: req.authContext.tenantId, page: 1, limit: 100 });
    const fromMemberships = memberships?.items?.filter((item) => item.companyId).map((item) => ({
      company_id: item.companyId,
      tenant_id: item.tenantId || req.authContext.tenantId,
      role: item.role,
    })) || [];
    const claims = req.authContext.authorizedCompanies;
    const companies = fromMemberships.length
      ? fromMemberships
      : (Array.isArray(claims) && claims.length
        ? claims
        : [{ company_id: req.authContext.companyId, tenant_id: req.authContext.tenantId }]);
    const items = await enrichCompanyOptions(companies, {
      getCompanyStore,
      fallbackTenantId: req.authContext.tenantId || null,
    });
    return res.json({
      success: true,
      data: { items },
      meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) },
    });
    } catch (error) { return next(error); }
  });
  const adminScope = requireAuthContext({ tenant: true, company: false, trustedScope: false, permission: "tenant.companies.manage", humanOnly: true });
  router.post("/api/v1/tenant/companies", adminScope, requireIdempotencyKey, async (req, res, next) => {
    try { if (typeof req.body?.name !== "string" || !req.body.name.trim()) throw validationError("Company name is required"); const result = await getCompanyStore().create({ tenantId: req.authContext.tenantId, companyId: req.body.company_id, name: req.body.name.trim(), legalName: req.body.legal_name, timezone: req.body.timezone, locale: req.body.locale, status: req.body.status || "pending", metadata: req.body.metadata }); return res.status(result.reused ? 200 : 201).json({ success: true, data: { company: serializeCompany(result.company), reused: result.reused }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); } catch (error) { return next(error); }
  });
  router.patch("/api/v1/tenant/companies/:companyId", adminScope, requireIdempotencyKey, async (req, res, next) => {
    try { const result = await getCompanyStore().update({ tenantId: req.authContext.tenantId, companyId: req.params.companyId, name: req.body?.name, legalName: req.body?.legal_name, status: req.body?.status, timezone: req.body?.timezone, locale: req.body?.locale, metadata: req.body?.metadata }); return res.json({ success: true, data: { company: serializeCompany(result.company) }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); } catch (error) { return next(error); }
  });
  const languageReadScope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "company_context.read" });
  const languageManageScope = requireAuthContext({ tenant: true, company: true, trustedScope: true, permission: "company.language.manage", humanOnly: true });
  router.get("/api/v1/companies/:companyId/language-preference", languageReadScope, async (req, res, next) => {
    try {
      if (req.params.companyId !== req.authContext.companyId) throw scopeError();
      const company = await getCompanyStore().get({ tenantId: req.authContext.tenantId, companyId: req.params.companyId });
      if (!company) throw Object.assign(new Error("Company was not found"), { code: "NOT_FOUND", statusCode: 404 });
      return res.json({ success: true, data: { language: resolveCompanyLanguage(company.locale) }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
    } catch (error) { return next(error); }
  });
  router.patch("/api/v1/companies/:companyId/language-preference", languageManageScope, requireIdempotencyKey, async (req, res, next) => {
    try {
      if (req.params.companyId !== req.authContext.companyId) throw scopeError();
      const language = normalizeLanguagePreference(req.body?.language);
      const result = await getCompanyStore().update({ tenantId: req.authContext.tenantId, companyId: req.params.companyId, locale: language });
      return res.json({ success: true, data: { language: resolveCompanyLanguage(result.company.locale) }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
    } catch (error) { return next(error); }
  });
  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}
function serializeCompany(item) { return { company_id: item.companyId, tenant_id: item.tenantId, name: item.name, legal_name: item.legalName || null, status: item.status, timezone: item.timezone || null, locale: item.locale || null, metadata: item.metadata || {}, created_at: item.createdAt, updated_at: item.updatedAt }; }
function requireIdempotencyKey(req, res, next) { const key = req.get("Idempotency-Key"); if (!key || key.length < 16 || key.length > 255) return sendError(res, req, validationError("Idempotency-Key header must be 16 to 255 characters")); return next(); }
function validationError(message) { return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 }); }
function scopeError() { return Object.assign(new Error("Company scope does not match authenticated context"), { code: "SCOPE_CONTEXT_UNTRUSTED", statusCode: 403 }); }
module.exports = { createCompanyRouter };
