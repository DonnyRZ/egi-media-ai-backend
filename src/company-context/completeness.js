"use strict";

const { CONTEXT_FIELDS, SCALAR_FIELDS } = require("../ai/tasks/t01-company-context-draft/schema");

const COMPLETENESS_RULE_VERSION = "review-v2";
const USER_CONFIRM_FIELDS = Object.freeze([
  "name",
  "industry",
  "description",
  "products",
  "customers",
  "regions",
  "priorities",
]);
const AI_REVIEW_FIELDS = Object.freeze([
  "sub_industry",
  "competitors",
  "goals",
  "risks",
  "topics",
  "dependencies",
]);
const OPTIONAL_FIELDS = Object.freeze(["brands_aliases", "key_people"]);
// Kept as aliases for callers that use the previous terminology.
const CORE_FIELDS = USER_CONFIRM_FIELDS;
const RECOMMENDED_FIELDS = AI_REVIEW_FIELDS;
const FIELD_REVIEW_STATUSES = Object.freeze([
  "missing",
  "ai_proposed",
  "user_confirmed",
  "reviewed_none_disclosed",
]);
const FIELD_LABELS = Object.freeze({
  name: "Company name",
  industry: "Industry",
  sub_industry: "Sub-industry",
  description: "Company description",
  products: "Products or services",
  customers: "Customers or market segments",
  regions: "Operating regions",
  competitors: "Competitors or alternatives",
  brands_aliases: "Brand names or aliases",
  key_people: "Key people",
  priorities: "Management priorities",
  goals: "Strategic goals",
  risks: "Key risks or constraints",
  topics: "Topics to monitor",
  dependencies: "Critical dependencies",
});

function evaluateContextCompleteness(fields = {}, fieldReview = null, { legacyEffective = fieldReview == null } = {}) {
  const review = normalizeFieldReview(fields, fieldReview, { legacyEffective });
  const missingRequiredFields = USER_CONFIRM_FIELDS.filter((field) => !hasContextValue(fields[field], field) || review[field] !== "user_confirmed");
  const missingReviewFields = AI_REVIEW_FIELDS.filter((field) => !hasContextValue(fields[field], field));
  const pendingReviewFields = AI_REVIEW_FIELDS.filter((field) => !["user_confirmed", "reviewed_none_disclosed"].includes(review[field]));
  const blockingFields = [...new Set([...missingRequiredFields, ...pendingReviewFields])];
  const fieldStatus = CONTEXT_FIELDS.map((field) => ({
    field,
    label: FIELD_LABELS[field] || field,
    level: USER_CONFIRM_FIELDS.includes(field) ? "required" : AI_REVIEW_FIELDS.includes(field) ? "ai_review" : "optional",
    present: hasContextValue(fields[field], field),
    review_status: review[field],
  }));
  return {
    status: blockingFields.length === 0 ? "complete" : "incomplete",
    complete: blockingFields.length === 0,
    blocking: blockingFields.length > 0,
    rule_version: COMPLETENESS_RULE_VERSION,
    required_fields: [...USER_CONFIRM_FIELDS],
    ai_review_fields: [...AI_REVIEW_FIELDS],
    optional_fields: [...OPTIONAL_FIELDS],
    core_fields: [...USER_CONFIRM_FIELDS],
    recommended_fields: [...AI_REVIEW_FIELDS],
    missing_core_fields: missingRequiredFields,
    missing_required_fields: missingRequiredFields,
    missing_recommended_fields: missingReviewFields,
    pending_review_fields: pendingReviewFields,
    field_review: review,
    field_status: fieldStatus,
  };
}

function createInitialFieldReview(fields = {}) {
  const result = {};
  for (const field of CONTEXT_FIELDS) {
    result[field] = hasContextValue(fields[field], field)
      ? "ai_proposed"
      : "missing";
    if (OPTIONAL_FIELDS.includes(field) && !hasContextValue(fields[field], field)) result[field] = "reviewed_none_disclosed";
  }
  return result;
}

function createManualFieldReview(fields = {}) {
  const result = {};
  for (const field of CONTEXT_FIELDS) {
    result[field] = hasContextValue(fields[field], field)
      ? "user_confirmed"
      : (AI_REVIEW_FIELDS.includes(field) || OPTIONAL_FIELDS.includes(field) ? "reviewed_none_disclosed" : "missing");
  }
  return result;
}

function normalizeFieldReview(fields = {}, fieldReview = null, { legacyEffective = false } = {}) {
  const review = {};
  for (const field of CONTEXT_FIELDS) {
    const supplied = fieldReview?.[field];
    if (FIELD_REVIEW_STATUSES.includes(supplied)) {
      review[field] = supplied;
      continue;
    }
    if (legacyEffective) {
      review[field] = hasContextValue(fields[field], field)
        ? "user_confirmed"
        : (AI_REVIEW_FIELDS.includes(field) || OPTIONAL_FIELDS.includes(field) ? "reviewed_none_disclosed" : "missing");
    } else {
      review[field] = hasContextValue(fields[field], field) ? "ai_proposed" : "missing";
    }
  }
  return review;
}

function allMissingFields(fields = {}) {
  return CONTEXT_FIELDS.filter((field) => !hasContextValue(fields[field], field));
}

function hasContextValue(value, field) {
  if (SCALAR_FIELDS.includes(field)) return typeof value === "string" && value.trim().length > 0;
  return Array.isArray(value) && value.length > 0;
}

function incompleteContextError(report, { companyId = null, contextVersion = null } = {}) {
  return Object.assign(new Error("Company Context is incomplete or still requires field review"), {
    code: "COMPANY_CONTEXT_INCOMPLETE",
    statusCode: 409,
    retryable: false,
    details: { companyId, contextVersion, completeness: report },
  });
}

module.exports = {
  COMPLETENESS_RULE_VERSION,
  USER_CONFIRM_FIELDS,
  AI_REVIEW_FIELDS,
  OPTIONAL_FIELDS,
  CORE_FIELDS,
  RECOMMENDED_FIELDS,
  FIELD_REVIEW_STATUSES,
  FIELD_LABELS,
  evaluateContextCompleteness,
  createInitialFieldReview,
  createManualFieldReview,
  normalizeFieldReview,
  allMissingFields,
  hasContextValue,
  incompleteContextError,
};
