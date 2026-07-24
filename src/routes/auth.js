const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
function createAuthRouter({ getCompanyStore, getTenantStore } = {}) {
  const router = express.Router();
  router.post("/api/v1/auth/login", async (req, res, next) => {
    try {
      const result = await req.app.locals.localAuthService.login({ email: req.body?.email, password: req.body?.password });
      const memberships = await req.app.locals.membershipStore?.listForUser?.({ userId: result.actor.id }) || [];
      const scoped = (await Promise.all(memberships.filter((item) => item.companyId).map(async (item) => ({ item, company: await getCompanyStore?.().get?.({ tenantId: item.tenantId, companyId: item.companyId }) })))).find(({ company }) => company?.status === "active")?.item || null;
      const accessToken = scoped ? req.app.locals.localAuthService.issueScopedToken({ actor: result.actor, tenantId: scoped.tenantId, companyId: scoped.companyId, membershipId: scoped.membershipId, role: scoped.role }) : result.accessToken;
      return res.json({ success: true, data: { access_token: accessToken, token_type: "Bearer", actor: { id: result.actor.id, email: result.actor.email, role: scoped?.role || result.actor.role, type: result.actor.actor_type }, tenant_id: scoped?.tenantId || null, company_id: scoped?.companyId || null, authorized_companies: memberships.filter((item) => item.companyId).map((item) => ({ company_id: item.companyId, tenant_id: item.tenantId, role: item.role })) }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
    } catch (error) { return next(error); }
  });
  router.post("/api/v1/auth/signup", async (req, res, next) => {
    try { const user = await req.app.locals.localAuthService.signup({ email: req.body?.email, password: req.body?.password, fullName: req.body?.full_name }); await req.app.locals.membershipStore?.activateByUser?.({ userId: user.userId }); return res.status(201).json({ success: true, data: { user: { user_id: user.userId, email: user.email, full_name: user.fullName, status: user.status } }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }); } catch (error) { return next(error); }
  });
  const actorOnly = requireAuthContext({ tenant: false, company: false });
  router.post("/api/v1/auth/switch-context", actorOnly, async (req, res, next) => {
    try {
      const tenantId = String(req.body?.tenant_id || "").trim(); const companyId = String(req.body?.company_id || "").trim();
      if (!tenantId || !companyId) throw Object.assign(new Error("Tenant and company are required"), { code: "VALIDATION_ERROR", statusCode: 400 });
      const company = await getCompanyStore?.().get?.({ tenantId, companyId });
      if (!company || company.status !== "active") throw Object.assign(new Error("The requested company is not active"), { code: "FORBIDDEN", statusCode: 403 });
      const tenant = await getTenantStore?.().get?.({ tenantId });
      if (tenant && tenant.status !== "active") throw Object.assign(new Error("The requested tenant is not active"), { code: "FORBIDDEN", statusCode: 403 });
      const membership = await req.app.locals.membershipStore.resolve({ userId: req.authContext.actor.actorId, tenantId, companyId, actorType: req.authContext.actor.actorType });
      if (!membership?.companyId && membership?.role !== "tenant_owner" && membership?.role !== "tenant_admin") throw Object.assign(new Error("An explicit company membership is required for this context"), { code: "FORBIDDEN", statusCode: 403 });
      const accessToken = req.app.locals.localAuthService.issueScopedToken({ actor: { id: req.authContext.actor.actorId, email: req.authContext.actor.email, full_name: req.authContext.actor.fullName, actor_type: req.authContext.actor.actorType }, tenantId, companyId, membershipId: membership.membershipId, role: membership.role });
      return res.json({ success: true, data: { access_token: accessToken, token_type: "Bearer", tenant_id: tenantId, company_id: companyId, role: membership.role }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
    } catch (error) { return next(error); }
  });
  const platformSession = requireAuthContext({ tenant: false, company: false, permission: "platform.tenants.manage", humanOnly: true, platform: true });
  const customerSession = requireAuthContext({ tenant: true, company: false, trustedScope: false });
  const sessionGuard = (req, res, next) => req.authContext?.actor?.role === "platform_superadmin" ? platformSession(req, res, next) : customerSession(req, res, next);
  router.get("/api/v1/auth/session", sessionGuard, async (req, res, next) => {
    try {
      const memberships = req.authContext.tenantId ? await req.app.locals.membershipStore?.list?.({ tenantId: req.authContext.tenantId, page: 1, limit: 100 }) : null;
      const authorizedCompanies = memberships?.items?.filter((item) => item.companyId).map((item) => ({ company_id: item.companyId, role: item.role })) || req.authContext.authorizedCompanies || [];
      if (!authorizedCompanies.length && req.authContext.companyId) authorizedCompanies.push({ company_id: req.authContext.companyId, role: req.authContext.role || req.authContext.actor.role });
      return res.json({ success: true, data: { actor: { id: req.authContext.actor.actorId, email: req.authContext.actor.email, type: req.authContext.actor.actorType, role: req.authContext.role || req.authContext.actor.role, membership_id: req.authContext.membership?.membershipId || req.authContext.actor.membershipId || null }, tenant_id: req.authContext.tenantId, company_id: req.authContext.companyId, role: req.authContext.role || req.authContext.actor.role, permissions: [...(req.authContext.permissions || [])], authorized_companies: authorizedCompanies }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
    } catch (error) { return next(error); }
  });
  return router;
}
module.exports = { createAuthRouter };
