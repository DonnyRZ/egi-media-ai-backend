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

test("issue formation requires identity subject_relation, not relevance alone", () => {
  assert.equal(shouldFormIssue({ relevance: "medium", subjectRelation: "market" }), false);
  assert.equal(shouldFormIssue({ relevance: "high", subjectRelation: "unrelated" }), false);
  assert.equal(shouldFormIssue({ relevance: "medium", subjectRelation: "self" }), true);
  assert.equal(shouldFormIssue({ relevance: "medium", subjectRelation: "competitor", competitorOptIn: false }), false);
  assert.equal(shouldFormIssue({ relevance: "medium", subjectRelation: "competitor", competitorOptIn: true }), true);
  assert.equal(shouldFormIssue({ relevance: "low", subjectRelation: "self" }), false);
});

test("branchForDecision stops market even when relevance is medium", () => {
  assert.equal(branchForDecision({ relevance: "medium", subjectRelation: "market" }), "stop");
  assert.equal(branchForDecision({ relevance: "high", subjectRelation: "self" }), "continue");
  assert.equal(branchForDecision({ relevance: "medium", subjectRelation: "competitor", competitorOptIn: true }), "continue");
  assert.equal(branchForDecision({ relevance: "medium", subjectRelation: null }), "stop");
});
