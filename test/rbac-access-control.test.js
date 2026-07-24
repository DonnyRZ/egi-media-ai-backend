const test = require("node:test");
const assert = require("node:assert/strict");
const { permissionsForRole, hasPermission } = require("../src/auth/rbac");
const { InMemoryMembershipStore } = require("../src/auth/membership.store");
const { AuthorizationService } = require("../src/auth/authorization");

test("RBAC role catalog separates customer roles from AI worker", () => {
  assert.equal(hasPermission("executive", "report.approve"), true);
  assert.equal(hasPermission("viewer", "report.approve"), false);
  assert.equal(hasPermission("ai_worker", "report.share"), false);
  assert.equal(permissionsForRole("platform_superadmin").has("platform.tenants.manage"), true);
});

test("membership resolution prefers company membership and falls back to tenant membership", async () => {
  const store = new InMemoryMembershipStore({ memberships: [
    { userId: "u-1", tenantId: "t-1", companyId: null, role: "viewer" },
    { userId: "u-1", tenantId: "t-1", companyId: "c-1", role: "executive" },
  ] });
  assert.equal((await store.resolve({ userId: "u-1", tenantId: "t-1", companyId: "c-1" })).role, "executive");
  assert.equal((await store.resolve({ userId: "u-1", tenantId: "t-1", companyId: "c-2" })).role, "viewer");
});

test("authorization rejects a missing tenant membership", async () => {
  const service = new AuthorizationService({ membershipStore: new InMemoryMembershipStore(), strictMembership: true });
  await assert.rejects(() => service.authorize({ actor: { actorId: "u-1", actorType: "human" }, tenantId: "t-1", companyId: "c-1" }, "dashboard.read"), { code: "FORBIDDEN" });
});

test("AI worker cannot approve reports even with a valid tenant membership", async () => {
  const store = new InMemoryMembershipStore({ memberships: [{ userId: "worker", tenantId: "t-1", companyId: "c-1", role: "ai_worker" }] });
  const service = new AuthorizationService({ membershipStore: store, strictMembership: true });
  await assert.rejects(() => service.authorize({ actor: { actorId: "worker", actorType: "ai_worker" }, tenantId: "t-1", companyId: "c-1" }, "report.approve", { humanOnly: true }), { code: "FORBIDDEN" });
});
