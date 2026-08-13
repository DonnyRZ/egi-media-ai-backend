const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { permissionsForRole } = require("../auth/rbac");
const { enrichCompanyOptions } = require("../auth/company-options");

function createAuthRouter({ getCompanyStore, getTenantStore } = {}) {
  const router = express.Router();
  router.post("/api/v1/auth/login", async (req, res, next) => {
    try {
      const result = await req.app.locals.localAuthService.login({ email: req.body?.email, password: req.body?.password });
      const memberships = await req.app.locals.membershipStore?.listForUser?.({ userId: result.actor.id }) || [];
      const isPlatformAdmin = result.actor.role === "platform_superadmin";
      const scoped = isPlatformAdmin ? null : (await Promise.all(
        memberships
          .filter((item) => item.companyId || isTenantOperator(item.role))
          .map(async (item) => ({
            item,
            company: item.companyId ? await getCompanyStore?.().get?.({ tenantId: item.tenantId, companyId: item.companyId }) : null,
          })),
      )).find(({ item, company }) => (!item.companyId && isTenantOperator(item.role)) || company?.status === "active")?.item || null;
      if (scoped) {
        const tenant = await getTenantStore?.()?.get?.({ tenantId: scoped.tenantId });
        if (tenant && tenant.status !== "active") {
          const label = tenant.status === "archived" ? "archived" : "temporarily suspended";
          throw Object.assign(new Error(`This customer workspace is ${label}`), { code: "TENANT_NOT_ACTIVE", statusCode: 403 });
        }
      }
      const accessToken = scoped ? req.app.locals.localAuthService.issueScopedToken({ actor: result.actor, tenantId: scoped.tenantId, companyId: scoped.companyId, membershipId: scoped.membershipId, role: scoped.role }) : result.accessToken;
      const role = isPlatformAdmin ? result.actor.role : (scoped?.role || result.actor.role);
      const permissions = [...permissionsForRole(role)];
      const authorizedCompanies = await listAuthorizedCompanies({
        tenantId: scoped?.tenantId || memberships.find((item) => item.tenantId)?.tenantId || null,
        role,
        memberships,
        getCompanyStore,
      });
      return res.json({ success: true, data: { access_token: accessToken, token_type: "Bearer", actor: { id: result.actor.id, email: result.actor.email, role, type: result.actor.actor_type }, tenant_id: scoped?.tenantId || null, company_id: scoped?.companyId || null, permissions, authorized_companies: authorizedCompanies }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
    } catch (error) { return next(error); }
  });
  router.post("/api/v1/auth/signup", async (_req, _res, next) => {
    next(Object.assign(new Error("Public signup is disabled. An administrator must create the account."), { code: "SIGNUP_DISABLED", statusCode: 410 }));
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
      const permissions = [...permissionsForRole(membership.role)];
      return res.json({ success: true, data: { access_token: accessToken, token_type: "Bearer", tenant_id: tenantId, company_id: companyId, role: membership.role, permissions, company_name: company.name || null }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
    } catch (error) { return next(error); }
  });
  const platformSession = requireAuthContext({ tenant: false, company: false, permission: "platform.tenants.manage", humanOnly: true, platform: true });
  const customerSession = requireAuthContext({ tenant: true, company: false, trustedScope: false });
  const sessionGuard = (req, res, next) => req.authContext?.actor?.role === "platform_superadmin" ? platformSession(req, res, next) : customerSession(req, res, next);
  router.get("/api/v1/auth/session", sessionGuard, async (req, res, next) => {
    try {
      let authorizedCompanies = [];
      if (req.authContext.tenantId) {
        const role = req.authContext.role || req.authContext.actor?.role;
        const memberships = await req.app.locals.membershipStore?.list?.({ tenantId: req.authContext.tenantId, page: 1, limit: 100 });
        if (isTenantOperator(role) && getCompanyStore?.()?.list) {
          const companies = await getCompanyStore().list({ tenantId: req.authContext.tenantId, page: 1, limit: 100 });
          authorizedCompanies = companies.items.map((item) => ({
            company_id: item.companyId,
            tenant_id: item.tenantId || req.authContext.tenantId,
            role,
          }));
        } else {
          const userMemberships = typeof req.app.locals.membershipStore?.listForUser === "function"
            ? await req.app.locals.membershipStore.listForUser({ userId: req.authContext.actor.actorId })
            : memberships?.items?.filter((item) => item.userId === req.authContext.actor.actorId) || [];
          authorizedCompanies = userMemberships
            .filter((item) => item.tenantId === req.authContext.tenantId && item.companyId)
            .map((item) => ({
            company_id: item.companyId,
            tenant_id: item.tenantId || req.authContext.tenantId,
            role: item.role,
            }));
        }
      } else if (req.authContext.actor?.actorId) {
        const forUser = await req.app.locals.membershipStore?.listForUser?.({ userId: req.authContext.actor.actorId }) || [];
        authorizedCompanies = forUser.filter((item) => item.companyId).map((item) => ({
          company_id: item.companyId,
          tenant_id: item.tenantId,
          role: item.role,
        }));
      }
      if (!authorizedCompanies.length && Array.isArray(req.authContext.authorizedCompanies)) {
        authorizedCompanies = req.authContext.authorizedCompanies.map((item) => (
          typeof item === "string"
            ? { company_id: item, tenant_id: req.authContext.tenantId || undefined }
            : {
              company_id: item.company_id || item.id,
              ...(item.tenant_id || item.tenantId || req.authContext.tenantId
                ? { tenant_id: item.tenant_id || item.tenantId || req.authContext.tenantId }
                : {}),
              role: item.role,
              ...(item.name ? { name: item.name } : {}),
            }
        ));
      }
      if (!authorizedCompanies.length && req.authContext.companyId) {
        authorizedCompanies.push({
          company_id: req.authContext.companyId,
          ...(req.authContext.tenantId ? { tenant_id: req.authContext.tenantId } : {}),
          role: req.authContext.role || req.authContext.actor.role,
        });
      }
      authorizedCompanies = await enrichCompanyOptions(authorizedCompanies, {
        getCompanyStore,
        fallbackTenantId: req.authContext.tenantId || null,
      });
      return res.json({ success: true, data: { actor: { id: req.authContext.actor.actorId, email: req.authContext.actor.email, type: req.authContext.actor.actorType, role: req.authContext.role || req.authContext.actor.role, membership_id: req.authContext.membership?.membershipId || req.authContext.actor.membershipId || null }, tenant_id: req.authContext.tenantId, company_id: req.authContext.companyId, role: req.authContext.role || req.authContext.actor.role, permissions: [...(req.authContext.permissions || [])], authorized_companies: authorizedCompanies }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
    } catch (error) { return next(error); }
  });
  return router;
}

async function listAuthorizedCompanies({ tenantId, role, memberships = [], getCompanyStore }) {
  if (tenantId && isTenantOperator(role) && getCompanyStore?.()?.list) {
    const companies = await getCompanyStore().list({ tenantId, page: 1, limit: 100 });
    return enrichCompanyOptions(
      companies.items.map((item) => ({ company_id: item.companyId, tenant_id: item.tenantId || tenantId, role })),
      { getCompanyStore, fallbackTenantId: tenantId },
    );
  }
  return enrichCompanyOptions(
    memberships.filter((item) => item.companyId).map((item) => ({ company_id: item.companyId, tenant_id: item.tenantId, role: item.role })),
    { getCompanyStore },
  );
}

function isTenantOperator(role) { return role === "tenant_owner" || role === "tenant_admin"; }

module.exports = { createAuthRouter };
