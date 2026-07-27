const test = require("node:test");
const assert = require("node:assert/strict");
const { enrichCompanyOptions, normalizeCompanyOption } = require("../src/auth/company-options");

test("normalizeCompanyOption accepts string ids and object shapes", () => {
  assert.deepEqual(normalizeCompanyOption("company-a", "tenant-a"), {
    company_id: "company-a",
    tenant_id: "tenant-a",
    name: null,
  });
  assert.deepEqual(
    normalizeCompanyOption({ companyId: "c1", tenantId: "t1", name: " Alpha ", role: "tenant_owner" }),
    { company_id: "c1", tenant_id: "t1", name: "Alpha", role: "tenant_owner" },
  );
});

test("enrichCompanyOptions attaches names for every company from the store", async () => {
  const store = {
    async list({ tenantId }) {
      assert.equal(tenantId, "tenant-a");
      return {
        items: [
          { companyId: "company-a", tenantId: "tenant-a", name: "Alpha Co" },
          { companyId: "company-b", tenantId: "tenant-a", name: "Beta Co" },
        ],
      };
    },
    async get() {
      throw new Error("get should not be needed when list succeeds");
    },
  };

  const enriched = await enrichCompanyOptions(
    [
      { company_id: "company-a", tenant_id: "tenant-a", role: "tenant_owner" },
      { company_id: "company-b", tenant_id: "tenant-a", role: "analyst" },
    ],
    { getCompanyStore: () => store },
  );

  assert.deepEqual(enriched, [
    { company_id: "company-a", tenant_id: "tenant-a", name: "Alpha Co", role: "tenant_owner" },
    { company_id: "company-b", tenant_id: "tenant-a", name: "Beta Co", role: "analyst" },
  ]);
});

test("enrichCompanyOptions leaves name null when company row is missing", async () => {
  const store = {
    async list() {
      return { items: [] };
    },
    async get() {
      return null;
    },
  };

  const enriched = await enrichCompanyOptions(
    [{ company_id: "missing", tenant_id: "tenant-a" }],
    { getCompanyStore: () => store },
  );

  assert.equal(enriched[0].name, null);
});
