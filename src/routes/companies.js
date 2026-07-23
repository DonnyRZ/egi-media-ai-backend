const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createCompanyRouter() {
  const router = express.Router();
  const scope = requireAuthContext({ tenant: true, company: true, trustedScope: true });
  router.get("/api/v1/companies", scope, (req, res) => {
    const claims = req.authContext.authorizedCompanies;
    const companies = Array.isArray(claims) && claims.length ? claims : [{ company_id: req.authContext.companyId, name: null }];
    return res.json({ success: true, data: { items: companies.map((item) => typeof item === "string" ? { company_id: item, name: null } : { company_id: item.company_id || item.id, name: item.name || null }) }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
  });
  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}
module.exports = { createCompanyRouter };
