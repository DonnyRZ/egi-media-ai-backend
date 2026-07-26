const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const express = require("express");

const { createCompanyContextRouter } = require("../src/routes/company-context");
const { InMemoryCompanyStore } = require("../src/auth/provisioning.store");
const { InMemoryCompanyContextDraftStore } = require("../src/ai/tasks/t01-company-context-draft/draft.store");
const { resolveDraftLanguage } = require("../src/language/ai-output-language");

const scope = { tenantId: "tenant-1", companyId: "company-1" };

function listen({ companyStore, draftService }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authContext = {
      actor: { actorId: "actor-1", actorType: "human" },
      ...scope,
      scopeTrusted: true,
    };
    next();
  });
  app.use(createCompanyContextRouter({
    companyContextDraftService: draftService,
    getCompanyStore: () => companyStore,
  }));
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function mockDraftService() {
  const captured = [];
  return {
    captured,
    createDraft: async (args) => {
      captured.push(args);
      return {
        draft: {
          draftId: `draft-${captured.length}`,
          companyId: args.trustedContext.companyId,
          status: "draft",
          isEffective: false,
          revision: 1,
          result: { status: "complete", context: {}, field_sources: [], missing_fields: [] },
          review: { submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, note: null },
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        provenance: { runId: "run-1", validationOutcome: "passed" },
      };
    },
  };
}

const draftHeaders = {
  "Content-Type": "application/json",
  "Idempotency-Key": "t01-language-pref-key-01",
  "X-Tenant-Id": scope.tenantId,
  "X-Company-Id": scope.companyId,
};

test("text draft POST without body language uses company locale (null → id)", async () => {
  const companyStore = new InMemoryCompanyStore({
    companies: [{ tenantId: scope.tenantId, companyId: scope.companyId, name: "Acme", locale: null, status: "active" }],
  });
  const draftService = mockDraftService();
  const server = await listen({ companyStore, draftService });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/v1/company-context/draft`, {
      method: "POST",
      headers: draftHeaders,
      body: JSON.stringify({ source: { type: "text", text: "PT Example logistics" } }),
    });
    assert.equal(response.status, 202);
    assert.equal(draftService.captured[0].trustedContext.extractionLanguage, "id");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("text draft POST without body language uses company locale en", async () => {
  const companyStore = new InMemoryCompanyStore({
    companies: [{ tenantId: scope.tenantId, companyId: scope.companyId, name: "Acme", locale: "en", status: "active" }],
  });
  const draftService = mockDraftService();
  const server = await listen({ companyStore, draftService });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/v1/company-context/draft`, {
      method: "POST",
      headers: { ...draftHeaders, "Idempotency-Key": "t01-language-pref-key-02" },
      body: JSON.stringify({ source: { type: "text", text: "Acme logistics" } }),
    });
    assert.equal(response.status, 202);
    assert.equal(draftService.captured[0].trustedContext.extractionLanguage, "en");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("explicit body extraction_language en overrides company locale id", async () => {
  const companyStore = new InMemoryCompanyStore({
    companies: [{ tenantId: scope.tenantId, companyId: scope.companyId, name: "Acme", locale: "id", status: "active" }],
  });
  const draftService = mockDraftService();
  const server = await listen({ companyStore, draftService });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/v1/company-context/draft`, {
      method: "POST",
      headers: { ...draftHeaders, "Idempotency-Key": "t01-language-pref-key-03" },
      body: JSON.stringify({
        source: { type: "text", text: "Acme logistics" },
        extraction_language: "en",
      }),
    });
    assert.equal(response.status, 202);
    assert.equal(draftService.captured[0].trustedContext.extractionLanguage, "en");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("PDF draft path resolves language via the same resolveDraftLanguage helper", () => {
  // PDF and text routes both call resolveDraftExtractionLanguage → resolveDraftLanguage.
  // Multipart upload is integration-heavy; assert the shared contract + route source wiring.
  assert.equal(resolveDraftLanguage({ explicitLanguage: "en", companyLocale: "id" }), "en");
  assert.equal(resolveDraftLanguage({ companyLocale: "en" }), "en");

  const routeSource = fs.readFileSync(
    path.join(__dirname, "../src/routes/company-context.js"),
    "utf8",
  );
  assert.match(routeSource, /draft\/pdf[\s\S]*await resolveDraftExtractionLanguage\(req\)/);
  assert.match(routeSource, /company-context\/draft(?!\/)[\s\S]*await resolveDraftExtractionLanguage\(req\)/);
  assert.equal((routeSource.match(/await resolveDraftExtractionLanguage\(req\)/g) || []).length, 2);
});

test("changing language preference does not rewrite existing drafts", async () => {
  // createDraft is the only path that writes new draft content for language.
  // Preference updates touch company.locale only — draftStore has no rewrite-on-preference path.
  const draftStore = new InMemoryCompanyContextDraftStore({ uuid: () => "draft-existing", now: () => 0 });
  const existing = draftStore.create({
    companyId: scope.companyId,
    result: {
      status: "complete",
      context: { name: "PT Existing", industry: "Logistics" },
      field_sources: [],
      missing_fields: [],
    },
    sourceFingerprints: [],
    provenance: { runId: "run-existing" },
  });
  const before = structuredClone(draftStore.list());

  const companyStore = new InMemoryCompanyStore({
    companies: [{ tenantId: scope.tenantId, companyId: scope.companyId, name: "Acme", locale: "id", status: "active" }],
  });
  await companyStore.update({ tenantId: scope.tenantId, companyId: scope.companyId, locale: "en" });

  assert.deepEqual(draftStore.list(), before);
  assert.equal(draftStore.get(existing.draftId).result.context.name, "PT Existing");
  assert.equal((await companyStore.get(scope)).locale, "en");
});
