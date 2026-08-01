const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

const { InMemoryCompanyContextDraftStore } = require("../src/ai/tasks/t01-company-context-draft/draft.store");
const { InMemoryEffectiveCompanyContextStore } = require("../src/company-context/effective-context.store");
const { CompanyContextService } = require("../src/company-context/company-context.service");
const { createCompanyContextRouter } = require("../src/routes/company-context");
const { createManualFieldReview } = require("../src/company-context/completeness");

function contextFields() {
  return {
    name: "PT Example", industry: "Logistics", sub_industry: null, description: "Fleet tracking services for logistics operators.",
    products: ["Fleet tracking"], customers: ["Logistics operators"], regions: ["Indonesia"], competitors: [],
    brands_aliases: [],
    key_people: [],
    priorities: ["Reduce costs"], goals: [], risks: ["Fuel cost volatility"], topics: [], dependencies: [],
  };
}

function createDraft(store, companyId = "company-1") {
  return store.create({
    companyId,
    result: {
      status: "complete",
      context: contextFields(),
      field_review: createManualFieldReview(contextFields()),
      field_sources: [],
      missing_fields: [],
    },
    sourceFingerprints: [],
    provenance: { runId: "run-1" },
  });
}

function createService({ authorize = async () => true } = {}) {
  const draftStore = new InMemoryCompanyContextDraftStore({
    uuid: (() => { let value = 0; return () => `draft-${++value}`; })(),
    now: () => 0,
  });
  const effectiveContextStore = new InMemoryEffectiveCompanyContextStore({
    uuid: (() => { let value = 0; return () => `context-${++value}`; })(),
    now: () => 0,
  });
  return {
    draftStore,
    effectiveContextStore,
    service: new CompanyContextService({ draftStore, effectiveContextStore, authorize }),
  };
}

const actor = { id: "human-1" };

test("save-and-activate: edit draft then approve from draft status becomes effective", async () => {
  const { draftStore, service } = createService();
  const draft = createDraft(draftStore);

  await assert.rejects(
    service.getEffectiveContext({ actor, companyId: "company-1" }),
    { code: "NOT_FOUND" },
  );

  const edited = await service.editDraft({
    actor,
    draftId: draft.draftId,
    fields: { industry: "Transport technology" },
    reviewNote: "Corrected industry",
  });
  assert.equal(edited.status, "draft");
  assert.equal(edited.revision, 2);
  assert.equal(edited.result.context.industry, "Transport technology");

  const { draft: approvedDraft, effectiveContext } = await service.approveDraft({
    actor,
    draftId: draft.draftId,
    approvalNote: "Saved and activated by owner",
  });
  assert.equal(approvedDraft.status, "approved");
  assert.equal(approvedDraft.isEffective, false);
  assert.equal(effectiveContext.status, "effective");
  assert.equal(effectiveContext.version, 1);
  assert.equal(effectiveContext.source, "ai_draft");
  assert.equal(effectiveContext.fields.industry, "Transport technology");

  const effective = await service.getEffectiveContext({ actor, companyId: "company-1" });
  assert.equal(effective.contextId, effectiveContext.contextId);
  await assert.rejects(
    service.editDraft({ actor, draftId: draft.draftId, fields: { industry: "Changed later" } }),
    { code: "VERSION_CONFLICT" },
  );
});

test("legacy in_review drafts remain activatable via approve", async () => {
  const { draftStore, service } = createService();
  const draft = createDraft(draftStore);

  const inReview = await service.submitForReview({ actor, draftId: draft.draftId, reviewNote: "Ready" });
  assert.equal(inReview.status, "in_review");

  const { draft: approvedDraft, effectiveContext } = await service.approveDraft({
    actor,
    draftId: draft.draftId,
    approvalNote: "Approved legacy review",
  });
  assert.equal(approvedDraft.status, "approved");
  assert.equal(effectiveContext.status, "effective");
  assert.equal(effectiveContext.version, 1);
});

test("editDraft and replaceEffectiveContext authorize with real RBAC permissions", async () => {
  const seen = [];
  const { draftStore, service } = createService({
    authorize: async ({ action }) => {
      seen.push(action);
      return true;
    },
  });
  const draft = createDraft(draftStore);

  await service.editDraft({ actor, draftId: draft.draftId, fields: { industry: "Energy" } });
  await service.replaceEffectiveContext({
    actor, companyId: "company-1", version: 1, fields: contextFields(), changeReason: "Manual",
  });

  assert.deepEqual(seen, ["company_context.draft", "company_context.draft"]);
});

test("analyst without approve cannot activate via approveDraft", async () => {
  const { draftStore, service } = createService({
    authorize: async ({ action }) => action === "company_context.draft" || action === "company_context.read",
  });
  const draft = createDraft(draftStore);

  const edited = await service.editDraft({
    actor,
    draftId: draft.draftId,
    fields: { industry: "Retail" },
  });
  assert.equal(edited.status, "draft");

  await assert.rejects(
    service.approveDraft({ actor, draftId: draft.draftId }),
    { code: "FORBIDDEN" },
  );
});

test("human manual write creates the next effective context version", async () => {
  const { service } = createService();
  const first = await service.replaceEffectiveContext({
    actor, companyId: "company-1", version: 1, fields: contextFields(), changeReason: "Initial human context",
  });
  const secondFields = { ...contextFields(), industry: "Updated industry" };
  const second = await service.replaceEffectiveContext({
    actor, companyId: "company-1", version: 2, fields: secondFields, changeReason: "Update",
  });
  assert.equal(first.context.version, 1);
  assert.equal(second.context.version, 2);
  assert.equal(second.context.source, "manual");
  await assert.rejects(
    service.replaceEffectiveContext({ actor, companyId: "company-1", version: 2, fields: secondFields }),
    { code: "VERSION_CONFLICT" },
  );
});

test("Company Context API activates from draft without submit-review", async () => {
  const { draftStore, service } = createService({
    authorize: async ({ actor: authorizedActor, companyId, action }) => authorizedActor.id === "human-1" && companyId === "company-1" && action.startsWith("company_context."),
  });
  const draft = createDraft(draftStore);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = actor; next(); });
  app.use(createCompanyContextRouter({ companyContextService: service }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const patch = await fetch(`${baseUrl}/api/v1/company-context/drafts/${draft.draftId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "edit-draft-key-1",
        "If-Match": "1",
      },
      body: JSON.stringify({ fields: { industry: "Finance" }, review_note: "Owner edit" }),
    });
    assert.equal(patch.status, 200);
    const patched = await patch.json();
    assert.equal(patched.data.status, "draft");
    assert.equal(patched.data.revision, 2);
    assert.equal(patched.data.result.context.industry, "Finance");

    const approve = await fetch(`${baseUrl}/api/v1/company-context/drafts/${draft.draftId}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "approve-draft-key-1",
        "If-Match": String(patched.data.revision),
      },
      body: JSON.stringify({ approval_note: "Activate" }),
    });
    assert.equal(approve.status, 200);
    assert.equal((await approve.json()).data.effective_context.status, "effective");

    const current = await fetch(`${baseUrl}/api/v1/companies/company-1/context`);
    assert.equal(current.status, 200);
    assert.equal((await current.json()).data.version, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Company Context review API rejects requests without authenticated actor", async () => {
  const { draftStore, service } = createService();
  const draft = createDraft(draftStore);
  const app = express();
  app.use(express.json());
  app.use(createCompanyContextRouter({ companyContextService: service }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/company-context/drafts/${draft.draftId}`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "UNAUTHORIZED");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
