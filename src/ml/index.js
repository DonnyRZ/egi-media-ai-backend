"use strict";

const { mapIndustry } = require("./industry-catalog-map");
const { createIndustryPrefilterClient } = require("./industry-prefilter.client");
const { InMemoryArticleIndustryDecisionStore } = require("./industry-decision.store");
const { hasCompanyIdentityHit } = require("../ai/tasks/t02-relevance-class/subject-identity-gate");

module.exports = {
  mapIndustry,
  createIndustryPrefilterClient,
  InMemoryArticleIndustryDecisionStore,
  hasCompanyIdentityHit,
};
