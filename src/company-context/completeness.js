"use strict";

const { CONTEXT_FIELDS, SCALAR_FIELDS } = require("../ai/tasks/t01-company-context-draft/schema");

const COMPLETENESS_RULE_VERSION = "core-v1";
const CORE_FIELDS = Object.freeze([
  "name",
  "industry",
  "description",
  "products",
  "customers",
  "regions",
  "priorities",
  "risks",
]);
const RECOMMENDED_FIELDS = Object.freeze([
  "sub_industry",
  "goals",
  "competitors",
  "topics",
  "dependencies",
]);
const FIELD_LABELS = Object.freeze({
  name: "Company name",
  industry: "Industry",
  description: "Company description",
  products: "Products or services",
  customers: "Customers or market segments",
  regions: "Operating regions",
  priorities: "Management priorities",
  risks: "Key risks or constraints",
  sub_industry: "Sub-industry",
  goals: "Strategic goals",
  competitors: "Competitors or alternatives",
  topics: "Topics to monitor",
  dependencies: "Critical dependencies",
});

function evaluateContextCompleteness(fields = {}) {
  const missingCoreFields = CORE_FIELDS.filter((field) => !hasContextValue(fields[field], field));
  const missingRecommendedFields = RECOMMENDED_FIELDS.filter((field) => !hasContextValue(fields[field], field));
  const fieldStatus = CONTEXT_FIELDS.map((field) => ({
    field,
    label: FIELD_LABELS[field] || field,
    level: CORE_FIELDS.includes(field) ? "core" : RECOMMENDED_FIELDS.includes(field) ? "recommended" : "optional",
    present: hasContextValue(fields[field], field),
  }));
  return {
    status: missingCoreFields.length === 0 ? "complete" : "incomplete",
    complete: missingCoreFields.length === 0,
    blocking: missingCoreFields.length > 0,
    rule_version: COMPLETENESS_RULE_VERSION,
    core_fields: [...CORE_FIELDS],
    recommended_fields: [...RECOMMENDED_FIELDS],
    missing_core_fields: missingCoreFields,
    missing_recommended_fields: missingRecommendedFields,
    field_status: fieldStatus,
  };
}

function allMissingFields(fields = {}) {
  return CONTEXT_FIELDS.filter((field) => !hasContextValue(fields[field], field));
}

function hasContextValue(value, field) {
  if (SCALAR_FIELDS.includes(field)) return typeof value === "string" && value.trim().length > 0;
  return Array.isArray(value) && value.length > 0;
}

function incompleteContextError(report, { companyId = null, contextVersion = null } = {}) {
  return Object.assign(new Error("Company Context is incomplete; add the missing core facts before activation or intake"), {
    code: "COMPANY_CONTEXT_INCOMPLETE",
    statusCode: 409,
    retryable: false,
    details: { companyId, contextVersion, completeness: report },
  });
}

module.exports = {
  COMPLETENESS_RULE_VERSION,
  CORE_FIELDS,
  RECOMMENDED_FIELDS,
  FIELD_LABELS,
  evaluateContextCompleteness,
  allMissingFields,
  incompleteContextError,
};
