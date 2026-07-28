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

test("context overlap gate ignores bare country/region tokens from company name", () => {
  const gated = applyContextOverlapGate({
    relevance: "medium",
    confidence: 0.7,
    fields: {
      ...fields,
      name: "PT Example Hospitality Indonesia",
      description: "Based in Indonesia",
      regions: ["Indonesia", "Jakarta"],
    },
    title: "Pemkot Serang tanam mangrove di pesisir Indonesia",
    summary: "Aksi lingkungan di kawasan pesisir tanpa tautan hotel.",
  });
  assert.equal(gated.relevance, "low");
  assert.equal(gated.gated, true);
});
