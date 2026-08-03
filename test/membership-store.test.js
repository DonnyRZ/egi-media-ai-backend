const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryMembershipStore } = require("../src/auth/membership.store");

test("tenant operators can resolve a newly created company without a company-scoped membership", async () => {
  const store = new InMemoryMembershipStore({
    memberships: [
      { membershipId: "owner-membership", userId: "owner-1", tenantId: "tenant-1", companyId: "company-1", role: "tenant_owner" },
      { membershipId: "analyst-membership", userId: "analyst-1", tenantId: "tenant-1", companyId: "company-1", role: "analyst" },
    ],
  });

  const resolved = await store.resolve({ userId: "owner-1", tenantId: "tenant-1", companyId: "company-2" });
  assert.equal(resolved.membershipId, "owner-membership");
  assert.equal(resolved.companyId, null);
  assert.equal(resolved.role, "tenant_owner");

  await assert.rejects(
    store.resolve({ userId: "analyst-1", tenantId: "tenant-1", companyId: "company-2" }),
    { code: "FORBIDDEN" },
  );
});

test("repeating an invite for the same user and company reuses the membership", async () => {
  const store = new InMemoryMembershipStore({
    memberships: [{ membershipId: "membership-1", userId: "user:analyst@example.com", tenantId: "tenant-1", companyId: "company-1", role: "analyst", status: "invited", version: 1 }],
  });

  const result = await store.invite({ email: "ANALYST@example.com", tenantId: "tenant-1", companyId: "company-1", role: "viewer" });

  assert.equal(result.reused, true);
  assert.equal(result.membership.membershipId, "membership-1");
  assert.equal(result.membership.version, 2);
  assert.equal(result.membership.role, "viewer");
  assert.equal((await store.list({ tenantId: "tenant-1" })).total, 1);
});
