const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuthContextMiddleware, requireAuthContext, AuthContextError, extractBearerToken } = require("../src/auth/auth-context");

function request(headers = {}) { return { get: (name) => headers[name] || headers[name.toLowerCase()] || undefined }; }

test("S03 normalizes actor and trusted tenant/company claims", () => {
  const middleware = createAuthContextMiddleware({ verifyToken: () => ({ id: "user-1", email: "u@example.com", role: "analyst", tenant_id: "tenant-1", company_id: "company-1" }) });
  const req = request({ Authorization: "Bearer token" });
  middleware(req, {}, (error) => assert.equal(error, undefined));
  assert.deepEqual(req.authContext, { actor: { actorId: "user-1", actorType: "human", email: "u@example.com", fullName: null, role: "analyst" }, tenantId: "tenant-1", companyId: "company-1", scopeSource: "jwt_claims", scopeTrusted: true });
  assert.deepEqual(req.user, req.authContext.actor);
});

test("S03 keeps anonymous requests explicit and does not trust headers as identity", () => {
  const middleware = createAuthContextMiddleware();
  const req = request({ "X-Tenant-Id": "tenant-header", "X-Company-Id": "company-header" });
  middleware(req, {}, (error) => assert.equal(error, undefined));
  assert.deepEqual(req.authContext, { actor: null, tenantId: null, companyId: null, scopeSource: "none", scopeTrusted: false });
});

test("S03 preserves requested header scope only after a valid actor token", () => {
  const middleware = createAuthContextMiddleware({ verifyToken: () => ({ sub: "user-2" }) });
  const req = request({ Authorization: "Bearer token", "X-Tenant-Id": "tenant-header", "X-Company-Id": "company-header" });
  middleware(req, {}, (error) => assert.equal(error, undefined));
  assert.equal(req.authContext.tenantId, "tenant-header");
  assert.equal(req.authContext.companyId, "company-header");
  assert.equal(req.authContext.scopeSource, "request_headers");
  assert.equal(req.authContext.scopeTrusted, false);
});

test("S03 requireAuthContext validates context without implementing RBAC", () => {
  const guard = requireAuthContext({ trustedScope: true });
  const req = { authContext: { actor: { actorId: "u" }, tenantId: "t", companyId: "c", scopeTrusted: true } };
  let called = false;
  guard(req, {}, (error) => { assert.equal(error, undefined); called = true; });
  assert.equal(called, true);
  const missing = { authContext: { actor: null } };
  guard(missing, {}, (error) => assert.equal(error.code, "UNAUTHORIZED"));
});

test("S03 rejects malformed bearer tokens and malformed identity", () => {
  assert.equal(extractBearerToken("Basic abc"), null);
  const middleware = createAuthContextMiddleware({ verifyToken: () => ({ email: "missing-id@example.com" }) });
  const req = request({ Authorization: "Bearer token" });
  middleware(req, {}, (error) => assert.equal(error instanceof AuthContextError, true));
});
