const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
function createAuthRouter() {
  const router = express.Router();
  router.get("/api/v1/auth/session", requireAuthContext({ tenant: true, company: true, trustedScope: true }), (req, res) => res.json({ success: true, data: { actor: { id: req.authContext.actor.actorId, email: req.authContext.actor.email, type: req.authContext.actor.actorType }, tenant_id: req.authContext.tenantId, company_id: req.authContext.companyId, authorized_companies: req.authContext.authorizedCompanies || [] }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } }));
  return router;
}
module.exports = { createAuthRouter };
