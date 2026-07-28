"use strict";

/** Relevance classes that may continue into issue matching / mutation (still need subject_relation). */
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
 * - self → may form issues (when relevance is high/medium)
 * - competitor → only when company_context.competitors is non-empty (opt-in)
 * - market / unrelated → never form issues
 */
function shouldFormIssue({ relevance, subjectRelation, competitorOptIn = false }) {
  if (!isContinuingRelevance(relevance)) return false;
  if (subjectRelation === "self") return true;
  if (subjectRelation === "competitor") return competitorOptIn === true;
  return false;
}

function branchForDecision({ relevance, subjectRelation = null, competitorOptIn = false } = {}) {
  // Legacy rows without subject_relation: fail closed on continue so market leaks cannot reopen.
  if (subjectRelation == null) {
    return "stop";
  }
  return shouldFormIssue({ relevance, subjectRelation, competitorOptIn }) ? "continue" : "stop";
}

/** @deprecated Prefer branchForDecision — relevance alone must not open issues. */
function branchForRelevance(relevance) {
  return isContinuingRelevance(relevance) ? "continue" : "stop";
}

module.exports = {
  CONTINUING_RELEVANCE,
  ALL_RELEVANCE,
  SUBJECT_RELATIONS,
  isContinuingRelevance,
  shouldFormIssue,
  branchForDecision,
  branchForRelevance,
};
