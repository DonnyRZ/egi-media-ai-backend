const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateContextCompleteness } = require("../src/company-context/completeness");
const { InMemoryCompanyContextDraftStore } = require("../src/ai/tasks/t01-company-context-draft/draft.store");
const { InMemoryEffectiveCompanyContextStore } = require("../src/company-context/effective-context.store");
const { CompanyContextService } = require("../src/company-context/company-context.service");

function completeFields() {
  return {
    name: "Acme Logistics",
    industry: "Logistics",
    sub_industry: null,
    description: "Fleet tracking and transport visibility for logistics operators.",
    products: ["Fleet tracking"],
    customers: ["Logistics operators"],
    regions: ["Indonesia"],
    competitors: [],
    brands_aliases: [],
    key_people: [],
    priorities: ["Reduce delivery cost"],
    goals: [],
    risks: ["Fuel cost volatility"],
    topics: [],
    dependencies: [],
  };
}

function createService() {
  const drafts = new InMemoryCompanyContextDraftStore({ uuid: () => "draft-1", now: () => 0 });
  const contexts = new InMemoryEffectiveCompanyContextStore({ uuid: () => "context-1", now: () => 0 });
  return { drafts, service: new CompanyContextService({ draftStore: drafts, effectiveContextStore: contexts, authorize: async () => true }) };
}

test("completeness gate distinguishes blocking core facts from recommended facts", () => {
  const report = evaluateContextCompleteness({ ...completeFields(), risks: [], competitors: [] });
  assert.equal(report.status, "incomplete");
  assert.deepEqual(report.missing_core_fields, ["risks"]);
  assert.deepEqual(report.missing_recommended_fields, ["sub_industry", "goals", "competitors", "topics", "dependencies"]);
  assert.equal(report.rule_version, "core-v1");
});

test("incomplete draft can be saved but cannot become effective", async () => {
  const { drafts, service } = createService();
  const draft = drafts.create({
    companyId: "company-1",
    result: { status: "insufficient_data", context: { ...completeFields(), risks: [] }, field_sources: [], missing_fields: ["risks"] },
    sourceFingerprints: [],
    provenance: {},
  });
  await assert.rejects(
    service.approveDraft({ actor: { id: "owner-1" }, draftId: draft.draftId }),
    (error) => error.code === "COMPANY_CONTEXT_INCOMPLETE"
      && error.details.completeness.missing_core_fields.includes("risks"),
  );
  const saved = await service.editDraft({ actor: { id: "owner-1" }, draftId: draft.draftId, fields: { risks: ["Fuel cost volatility"] } });
  assert.equal(saved.result.completeness.complete, true);
  const activated = await service.approveDraft({ actor: { id: "owner-1" }, draftId: saved.draftId });
  assert.equal(activated.effectiveContext.completeness.complete, true);
});
