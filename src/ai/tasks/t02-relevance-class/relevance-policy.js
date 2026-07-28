"use strict";

/** Relevance classes that may continue into issue matching / mutation. */
const CONTINUING_RELEVANCE = Object.freeze(["high", "medium"]);

/** All valid T02 relevance classes. */
const ALL_RELEVANCE = Object.freeze(["high", "medium", "low", "none"]);

function isContinuingRelevance(relevance) {
  return CONTINUING_RELEVANCE.includes(relevance);
}

function branchForRelevance(relevance) {
  return isContinuingRelevance(relevance) ? "continue" : "stop";
}

module.exports = {
  CONTINUING_RELEVANCE,
  ALL_RELEVANCE,
  isContinuingRelevance,
  branchForRelevance,
};
