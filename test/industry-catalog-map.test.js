"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { mapIndustry } = require("../src/ml/industry-catalog-map");

test("maps technology services to it", () => {
  assert.equal(mapIndustry({ industry: "Technology services" }), "it");
});

test("maps hospitality operations to hospitality", () => {
  assert.equal(mapIndustry({ industry: "Hospitality operations" }), "hospitality");
});

test("maps digital financial services to banking, not it", () => {
  assert.equal(mapIndustry({ industry: "Digital financial services" }), "banking");
});

test("maps logistics to transportation (no frozen model, fail-open)", () => {
  assert.equal(mapIndustry({ industry: "Logistics" }), "transportation");
});

test("leaves unknown industry unmapped", () => {
  assert.equal(mapIndustry({ industry: "Retail fashion" }), null);
  assert.equal(mapIndustry({}), null);
});

test("transport technology is transportation, not it", () => {
  assert.equal(mapIndustry({ industry: "Transport technology" }), "transportation");
});
