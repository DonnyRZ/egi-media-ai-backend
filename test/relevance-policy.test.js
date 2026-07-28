const assert = require("node:assert/strict");
const test = require("node:test");
const { branchForRelevance, isContinuingRelevance, CONTINUING_RELEVANCE } = require("../src/ai/tasks/t02-relevance-class/relevance-policy");

test("only high and medium continue to issue formation", () => {
  assert.deepEqual(CONTINUING_RELEVANCE, ["high", "medium"]);
  assert.equal(isContinuingRelevance("high"), true);
  assert.equal(isContinuingRelevance("medium"), true);
  assert.equal(isContinuingRelevance("low"), false);
  assert.equal(isContinuingRelevance("none"), false);
  assert.equal(branchForRelevance("low"), "stop");
  assert.equal(branchForRelevance("none"), "stop");
  assert.equal(branchForRelevance("medium"), "continue");
});
