"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const { applyMarketMaterialityGate } = require("../src/ai/tasks/t02-relevance-class/market-materiality-gate");
const { shouldFormIssue } = require("../src/ai/tasks/t02-relevance-class/relevance-policy");

const casesPath = path.join(__dirname, "../eval/management-intelligence/production-cases.json");
const fixture = JSON.parse(fs.readFileSync(casesPath, "utf8"));
const fields = fixture.context.fields;

function gateCase(id, relevance = "medium") {
  const item = fixture.cases.find((entry) => entry.id === id);
  assert.ok(item, `missing case ${id}`);
  return applyMarketMaterialityGate({
    relevance,
    confidence: 0.8,
    subjectRelation: "market",
    fields,
    title: item.source.article.title,
    summary: item.source.article.summary,
  });
}

test("market materiality gate keeps concrete peer lodging promo", () => {
  const gated = gateCase("TP-1");
  assert.equal(gated.gated, false);
  assert.equal(gated.relevance, "medium");
  assert.equal(shouldFormIssue({ relevance: gated.relevance, subjectRelation: "market" }), true);
});

test("market materiality gate keeps region infrastructure project", () => {
  const gated = gateCase("TP-2", "high");
  assert.equal(gated.gated, false);
  assert.equal(gated.relevance, "high");
  assert.ok([
    "product_industry_overlap",
    "region_project_or_regulation",
    "peer_family_commercial_action",
    "operating_industry_destination_project",
  ].includes(gated.hook));
});

test("market materiality gate keeps peer dining commercial event", () => {
  const gated = gateCase("TP-3", "medium");
  assert.equal(gated.gated, false, `Padang should keep, got reason=${gated.reason}`);
  assert.equal(gated.relevance, "medium");
});

test("market materiality gate upgrades underrated peer dining commercial event from low", () => {
  const gated = gateCase("TP-3", "low");
  assert.equal(gated.gated, true);
  assert.equal(gated.reason, "peer_commercial_action_upgrade");
  assert.equal(gated.relevance, "medium");
  assert.equal(shouldFormIssue({ relevance: gated.relevance, subjectRelation: "market" }), true);
});

test("market materiality gate demotes local roadwork even if model says medium", () => {
  const gated = gateCase("TN-2", "medium");
  assert.equal(gated.gated, true);
  assert.equal(gated.relevance, "low");
  assert.equal(shouldFormIssue({ relevance: gated.relevance, subjectRelation: "market" }), false);
});

test("market materiality gate does not upgrade false positives from low", () => {
  for (const id of ["FP-1", "FP-2", "FP-3", "FP-4", "TN-2"]) {
    const gated = gateCase(id, "low");
    assert.equal(gated.relevance, "low", `${id} must stay low when model already says low`);
    assert.ok(!String(gated.reason || "").includes("upgrade"), `${id} unexpected upgrade ${gated.reason}`);
  }
});

test("market materiality gate stops unrelated vendor water-heater metric", () => {
  const gated = gateCase("FP-1");
  assert.equal(gated.gated, true);
  assert.equal(gated.relevance, "low");
  assert.equal(gated.reason, "market_without_direct_context_hook");
  assert.equal(shouldFormIssue({ relevance: gated.relevance, subjectRelation: "market" }), false);
});

test("market materiality gate stops labour advocacy without direct hospitality hook", () => {
  const gated = gateCase("FP-2");
  assert.equal(gated.gated, true);
  assert.equal(gated.relevance, "low");
});

test("market materiality gate stops generic equity-index movement", () => {
  const gated = gateCase("FP-3");
  assert.equal(gated.gated, true);
  assert.equal(gated.relevance, "low");
});

test("market materiality gate stops broad mangrove programme without property hook in title/summary", () => {
  const gated = gateCase("FP-4");
  assert.equal(gated.gated, true);
  assert.equal(gated.relevance, "low");
});

test("market materiality gate does not alter self/competitor continuing decisions", () => {
  const gated = applyMarketMaterialityGate({
    relevance: "high",
    confidence: 0.9,
    subjectRelation: "self",
    fields,
    title: "Unrelated sports score update",
    summary: "A football match ended 2-1.",
  });
  assert.equal(gated.gated, false);
  assert.equal(gated.relevance, "high");
});

test("manufacturing family keeps peer factory news without hospitality tokens", () => {
  const manufacturing = {
    name: "Vector Components",
    industry: "Industrial components manufacturing",
    products: ["Precision control modules"],
    regions: ["Industrial Zone Three"],
    topics: [],
    priorities: [],
    goals: [],
    dependencies: [],
    competitors: [],
  };
  const gated = applyMarketMaterialityGate({
    relevance: "medium",
    confidence: 0.8,
    subjectRelation: "market",
    fields: manufacturing,
    title: "Peer factory expands automated packing line nearby",
    summary: "A component plant launches a new production expansion in the industrial zone.",
  });
  assert.equal(gated.gated, false);
  assert.ok(gated.hook);
});
