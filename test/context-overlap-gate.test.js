"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { hasIndustryPriorityOverlap } = require("../src/ai/tasks/t02-relevance-class/context-overlap-gate");

const fields = {
  industry: "Hospitality operations",
  products: ["Luxury hotel management", "Resort dining"],
  topics: ["Guest experience", "Hotel pre-opening"],
  regions: ["Indonesia", "Jakarta"],
  priorities: ["Direct booking growth"],
  goals: [],
  customers: ["Local community families"],
  competitors: [],
  brands_aliases: [],
  key_people: [],
  risks: [],
  dependencies: [],
  name: "PT Example Hospitality Indonesia",
  description: "Based in Indonesia serving masyarakat lokal",
  sub_industry: "Hotel and restaurant management",
};

test("industry/priority overlap is false without field hooks", () => {
  assert.equal(
    hasIndustryPriorityOverlap(
      fields,
      "Bentrokan warga menyebabkan motor hangus",
      "Satu orang tewas dalam bentrokan di kawasan padat masyarakat.",
    ),
    false,
  );
});

test("industry/priority overlap ignores country name and generic community words", () => {
  assert.equal(
    hasIndustryPriorityOverlap(
      fields,
      "Pemkot Serang tanam mangrove di pesisir Indonesia",
      "Aksi lingkungan bersama warga tanpa tautan operasi properti.",
    ),
    false,
  );
});

test("industry/priority overlap is true when product/topic tokens exist", () => {
  assert.equal(
    hasIndustryPriorityOverlap(
      fields,
      "Hotel promo July Mid Year Magic",
      "Resort dining package for guest experience.",
    ),
    true,
  );
});

test("single generic priority token is not enough for overlap", () => {
  assert.equal(
    hasIndustryPriorityOverlap(
      fields,
      "Efisiensi energi water heater rumah tangga",
      "Konsumen memprioritaskan hemat daya tanpa kaitan properti penginapan.",
    ),
    false,
  );
});
