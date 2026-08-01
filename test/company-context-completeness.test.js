const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateContextCompleteness,
  createManualFieldReview,
  createInitialFieldReview,
} = require("../src/company-context/completeness");
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

test("completeness gate requires user facts but allows reviewed AI-derived fields to be undisclosed", () => {
  const fields = { ...completeFields(), risks: [], competitors: [] };
  const report = evaluateContextCompleteness(fields, createManualFieldReview(fields));
  assert.equal(report.status, "complete");
  assert.deepEqual(report.missing_required_fields, []);
  assert.deepEqual(report.pending_review_fields, []);
  assert.equal(report.rule_version, "review-v2");
});

test("incomplete required facts and unreviewed AI proposals block activation", async () => {
  const { drafts, service } = createService();
  const draft = drafts.create({
    companyId: "company-1",
    result: {
      status: "insufficient_data",
      context: { ...completeFields(), priorities: [], risks: [] },
      field_review: createInitialFieldReview({ ...completeFields(), priorities: [], risks: [] }),
      field_sources: [],
      missing_fields: ["priorities"],
    },
    sourceFingerprints: [],
    provenance: {},
  });
  await assert.rejects(
    service.approveDraft({ actor: { id: "owner-1" }, draftId: draft.draftId }),
    (error) => error.code === "COMPANY_CONTEXT_INCOMPLETE"
      && error.details.completeness.missing_required_fields.includes("priorities")
      && error.details.completeness.pending_review_fields.includes("risks"),
  );
  const fields = { ...completeFields(), priorities: [], risks: [] };
  const saved = await service.editDraft({
    actor: { id: "owner-1" },
    draftId: draft.draftId,
    fields: { priorities: ["Reduce delivery cost"] },
    fieldReview: {
      ...createManualFieldReview({ ...completeFields(), priorities: ["Reduce delivery cost"], risks: [] }),
    },
  });
  assert.equal(saved.result.completeness.complete, true);
  const activated = await service.approveDraft({ actor: { id: "owner-1" }, draftId: saved.draftId });
  assert.equal(activated.effectiveContext.completeness.complete, true);
});
