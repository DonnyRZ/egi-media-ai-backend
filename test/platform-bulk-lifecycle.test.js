const test = require("node:test");
const assert = require("node:assert/strict");

process.env.APP_PORT = "0";
require("./support/test-env");
const Server = require("../src/app/server");

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  return { response, body: await response.json() };
}

function json(value) { return JSON.stringify(value); }

test("platform bulk lifecycle suspends selected or filtered workspaces atomically and audits each change", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const server = new Server();
  const listener = await server.listen();
  const base = `http://localhost:${listener.address().port}`;
  try {
    const login = await request(base, "/api/v1/auth/login", { method: "POST", body: json({ email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: process.env.BOOTSTRAP_ADMIN_PASSWORD }) });
    assert.equal(login.response.status, 200);
    const auth = { Authorization: `Bearer ${login.body.data.access_token}` };
    const create = async (id, name, status = "active") => {
      const result = await request(base, "/api/v1/platform/tenants", { method: "POST", headers: { ...auth, "Idempotency-Key": `bulk-create-${id}` }, body: json({ tenant_id: id, name, status }) });
      assert.equal(result.response.status, 201);
    };
    const activeA = `bulk-a-${suffix}`;
    const activeB = `bulk-b-${suffix}`;
    const pending = `bulk-pending-${suffix}`;
    await create(activeA, `Bulk Select A ${suffix}`);
    await create(activeB, `Bulk Select B ${suffix}`);
    await create(pending, `Bulk Pending ${suffix}`, "pending");

    const selected = await request(base, "/api/v1/platform/tenants/bulk-lifecycle", { method: "POST", headers: { ...auth, "Idempotency-Key": `bulk-suspend-selected-${suffix}` }, body: json({ tenant_ids: [activeA, activeB], status: "suspended", reason: "Subscription ended" }) });
    assert.equal(selected.response.status, 200);
    assert.equal(selected.body.data.updated_count, 2);
    assert.deepEqual(selected.body.data.tenants.map((item) => item.status), ["suspended", "suspended"]);

    const mixed = await request(base, "/api/v1/platform/tenants/bulk-lifecycle", { method: "POST", headers: { ...auth, "Idempotency-Key": `bulk-suspend-mixed-${suffix}` }, body: json({ tenant_ids: [activeA, pending], status: "suspended", reason: "Should fail atomically" }) });
    assert.equal(mixed.response.status, 409);
    const pendingList = await request(base, `/api/v1/platform/tenants?q=${encodeURIComponent(`Bulk Pending ${suffix}`)}`, { headers: auth });
    assert.equal(pendingList.body.data.items[0].status, "pending");

    const filtered = await request(base, "/api/v1/platform/tenants/bulk-lifecycle", { method: "POST", headers: { ...auth, "Idempotency-Key": `bulk-filter-${suffix}` }, body: json({ filter: { status: "suspended", q: `Bulk Select` }, status: "active", reason: "Customer renewed" }) });
    assert.equal(filtered.response.status, 200);
    assert.equal(filtered.body.data.updated_count, 2);

    const audit = await request(base, "/api/v1/platform/audit-events", { headers: auth });
    const events = audit.body.data.items.filter((item) => item.action === "tenant.lifecycle.change" && item.metadata?.bulk === true && [activeA, activeB].includes(item.tenant_id));
    assert.equal(events.length, 4);
  } finally {
    await server.stop();
  }
});
