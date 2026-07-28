const assert = require("node:assert/strict");
const test = require("node:test");
const { applyContextOverlapGate } = require("../src/ai/tasks/t02-relevance-class/context-overlap-gate");

const fields = {
  industry: "Hospitality operations",
  products: ["Luxury hotel management", "Resort dining"],
  topics: ["Guest experience", "Hotel pre-opening"],
  regions: ["Jakarta", "Bali"],
  priorities: ["Direct booking growth"],
  goals: [], customers: [], competitors: [], risks: [], dependencies: [],
  name: "Example Hospitality Co",
  description: "Operates hotels and resorts",
};

test("context overlap gate downgrades continuing relevance without field hooks", () => {
  const gated = applyContextOverlapGate({
    relevance: "medium",
    confidence: 0.7,
    fields,
    title: "Bentrokan warga menyebabkan motor hangus",
    summary: "Satu orang tewas dalam bentrokan di kawasan padat.",
  });
  assert.equal(gated.relevance, "low");
  assert.equal(gated.gated, true);
  assert.equal(gated.reason, "no_company_context_field_overlap");
});

test("context overlap gate keeps continuing relevance when hooks exist", () => {
  const kept = applyContextOverlapGate({
    relevance: "medium",
    confidence: 0.7,
    fields,
    title: "Hotel promo July Mid Year Magic",
    summary: "Resort dining package for guest experience in Jakarta.",
  });
  assert.equal(kept.relevance, "medium");
  assert.equal(kept.gated, false);
  assert.ok(kept.hits >= 1);
});
