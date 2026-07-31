"use strict";

/** Relevance classes that may continue into issue matching / mutation. */
const CONTINUING_RELEVANCE = Object.freeze(["high", "medium"]);

/** All valid T02 relevance classes. */
const ALL_RELEVANCE = Object.freeze(["high", "medium", "low", "none"]);

/** Who the article is about relative to company_context.fields. */
const SUBJECT_RELATIONS = Object.freeze(["self", "competitor", "market", "unrelated"]);

function isContinuingRelevance(relevance) {
  return CONTINUING_RELEVANCE.includes(relevance);
}

/**
 * Issue formation policy:
 * - self / competitor / market → may form issues when relevance is high/medium
 * - unrelated → never forms an issue
 *
 * subject_relation controls analysis framing, not whether a material external
 * signal is useful to management. Unlisted peers are classified as market.
 * competitorOptIn (listed competitors[]) does not gate issue formation.
 */
function shouldFormIssue({ relevance, subjectRelation }) {
  if (!isContinuingRelevance(relevance)) return false;
  return subjectRelation === "self"
    || subjectRelation === "competitor"
    || subjectRelation === "market";
}

function branchForDecision({ relevance, subjectRelation = null } = {}) {
  // Legacy rows without subject_relation remain fail-closed.
  if (subjectRelation == null) {
    return "stop";
  }
  return shouldFormIssue({ relevance, subjectRelation }) ? "continue" : "stop";
}

module.exports = {
  CONTINUING_RELEVANCE,
  ALL_RELEVANCE,
  SUBJECT_RELATIONS,
  isContinuingRelevance,
  shouldFormIssue,
  branchForDecision,
};
