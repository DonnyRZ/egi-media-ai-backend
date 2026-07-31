"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  branchForDecision,
  isContinuingRelevance,
  shouldFormIssue,
  CONTINUING_RELEVANCE,
} = require("../src/ai/tasks/t02-relevance-class/relevance-policy");

test("only high and medium are continuing relevance classes", () => {
  assert.deepEqual(CONTINUING_RELEVANCE, ["high", "medium"]);
  assert.equal(isContinuingRelevance("high"), true);
  assert.equal(isContinuingRelevance("medium"), true);
  assert.equal(isContinuingRelevance("low"), false);
  assert.equal(isContinuingRelevance("none"), false);
});

test("material self, competitor, and market signals may form issues", () => {
  assert.equal(shouldFormIssue({ relevance: "medium", subjectRelation: "market" }), true);
  assert.equal(shouldFormIssue({ relevance: "high", subjectRelation: "unrelated" }), false);
  assert.equal(shouldFormIssue({ relevance: "medium", subjectRelation: "self" }), true);
  assert.equal(shouldFormIssue({ relevance: "medium", subjectRelation: "competitor" }), true);
  assert.equal(shouldFormIssue({ relevance: "low", subjectRelation: "self" }), false);
});

test("branchForDecision continues material market intelligence and stops unrelated", () => {
  assert.equal(branchForDecision({ relevance: "medium", subjectRelation: "market" }), "continue");
  assert.equal(branchForDecision({ relevance: "high", subjectRelation: "self" }), "continue");
  assert.equal(branchForDecision({ relevance: "medium", subjectRelation: "competitor" }), "continue");
  assert.equal(branchForDecision({ relevance: "medium", subjectRelation: null }), "stop");
});
