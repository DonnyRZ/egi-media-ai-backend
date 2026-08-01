"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveManagementIdentityReadiness,
  assertManagementIdentityReady,
  serializeManagementIdentitySummary,
} = require("../src/ai/identity/readiness");
const { InMemoryEffectiveCompanyContextStore } = require("../src/company-context/effective-context.store");
const { InMemoryManagementIdentityStore } = require("../src/ai/identity/identity.store");
const { enqueueIngestTrigger } = require("../src/ingest/ingest-trigger");
const { InMemoryPipelineCompanyStore, PostgresPipelineCompanyStore } = require("../src/automation/company-scope");
const { leadershipSystemPreamble } = require("../src/ai/identity/prompt-stamp");
const { createManualFieldReview } = require("../src/company-context/completeness");

function completeFields() {
  return {
    name: "Acme", industry: "Logistics", sub_industry: null, description: "Fleet tracking services.",
    products: ["Fleet tracking"], customers: ["Logistics operators"], regions: ["Indonesia"],
    competitors: [], brands_aliases: [], key_people: [], priorities: ["Cost control"], goals: [],
    risks: ["Fuel costs"], topics: [], dependencies: [],
  };
}

describe("management identity readiness", () => {
  it("reports missing when no effective context exists", async () => {
    const readiness = await resolveManagementIdentityReadiness({
      effectiveContextStore: new InMemoryEffectiveCompanyContextStore(),
      identityStore: new InMemoryManagementIdentityStore(),
      companyId: "co-1",
      tenantId: "ten-1",
    });
    assert.equal(readiness.ready, false);
    assert.equal(readiness.status, "missing");
    assert.equal(readiness.hasEffectiveContext, false);
  });

  it("reports missing when context exists without identity row", async () => {
    const contexts = new InMemoryEffectiveCompanyContextStore();
    contexts.activate({
      tenantId: "ten-1",
      companyId: "co-1",
      fields: completeFields(),
      source: "manual",
      actorId: "actor-1",
    });
    const readiness = await resolveManagementIdentityReadiness({
      effectiveContextStore: contexts,
      identityStore: new InMemoryManagementIdentityStore(),
      companyId: "co-1",
      tenantId: "ten-1",
    });
    assert.equal(readiness.ready, false);
    assert.equal(readiness.status, "missing");
    assert.equal(readiness.hasEffectiveContext, true);
  });

  it("reports ready when identity status is ready", async () => {
    const contexts = new InMemoryEffectiveCompanyContextStore();
    const activated = contexts.activate({
      tenantId: "ten-1",
      companyId: "co-1",
      fields: completeFields(),
      source: "manual",
      actorId: "actor-1",
    });
    const identities = new InMemoryManagementIdentityStore();
    identities.upsert({
      tenantId: "ten-1",
      companyId: "co-1",
      contextVersion: activated.context.version,
      status: "ready",
      identity: {
        version: "1.0.0",
        company_name: "Acme",
        identity: "You are Acme leadership.",
        lens_summary: "Focus on core products",
        fingerprint: "abc",
      },
    });
    const readiness = await resolveManagementIdentityReadiness({
      effectiveContextStore: contexts,
      identityStore: identities,
      companyId: "co-1",
      tenantId: "ten-1",
    });
    assert.equal(readiness.ready, true);
    assert.equal(readiness.status, "ready");
    await assertManagementIdentityReady({
      effectiveContextStore: contexts,
      identityStore: identities,
      companyId: "co-1",
      tenantId: "ten-1",
    });
  });

  it("serialize summary defaults to missing", () => {
    assert.equal(serializeManagementIdentitySummary(null).status, "missing");
  });
});

describe("intake enqueue identity gate", () => {
  it("rejects enqueue when assertIntakeReady throws", async () => {
    await assert.rejects(
      () => enqueueIngestTrigger({
        queue: { enqueue: async () => ({ reused: false, job: { jobId: "j1", status: "queued" } }) },
        tenantId: "ten-1",
        companyId: "co-1",
        body: { mode: "crawl-poll", locale: "id", limit: 10, crawl_source_id: "detik" },
        idempotencyKey: "idempotency-key-1234",
        assertIntakeReady: async () => {
          const error = new Error("blocked");
          error.code = "MANAGEMENT_IDENTITY_REQUIRED";
          error.statusCode = 409;
          throw error;
        },
      }),
      (error) => error.code === "MANAGEMENT_IDENTITY_REQUIRED",
    );
  });
});

describe("listEligible requires ready identity flag", () => {
  it("excludes companies without hasReadyManagementIdentity", async () => {
    const store = new InMemoryPipelineCompanyStore({
      companies: [
        { tenantId: "t1", companyId: "c1", hasEffectiveContext: true, hasReadyManagementIdentity: true },
        { tenantId: "t1", companyId: "c2", hasEffectiveContext: true, hasReadyManagementIdentity: false },
      ],
    });
    const eligible = await store.listEligible();
    assert.deepEqual(eligible.map((item) => item.companyId), ["c1"]);
  });

  it("excludes a PostgreSQL company whose effective context is incomplete", async () => {
    const store = new PostgresPipelineCompanyStore({
      db: {
        query: async () => ({ rows: [
          { tenant_id: "t1", company_id: "complete", content_jsonb: { fields: completeFields(), fieldReview: createManualFieldReview(completeFields()) } },
          { tenant_id: "t1", company_id: "incomplete", content_jsonb: { fields: { ...completeFields(), risks: [] }, fieldReview: { priorities: "user_confirmed", risks: "ai_proposed" } } },
        ] }),
      },
    });
    const eligible = await store.listEligible();
    assert.deepEqual(eligible.map((item) => item.companyId), ["complete"]);
  });
});

describe("leadership preamble hard-requires identity", () => {
  it("throws without management identity", () => {
    assert.throws(
      () => leadershipSystemPreamble({ fields: { company_name: "Acme" } }),
      (error) => error.code === "MANAGEMENT_IDENTITY_REQUIRED",
    );
  });

  it("returns persona when identity present", () => {
    const text = leadershipSystemPreamble({
      managementIdentity: {
        identity: "You are Acme leadership.",
        company_name: "Acme",
      },
    });
    assert.match(text, /You are Acme leadership/);
  });
});
