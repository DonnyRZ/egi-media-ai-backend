"use strict";

/**
 * Lexical helpers shared by subject-identity and market-materiality gates.
 *
 * The old continue-path demotion gate (applyContextOverlapGate) is removed:
 * topic/priority coincidence alone must not open or close issues. Materiality
 * decisions live in market-materiality-gate.js; entity identity lives in
 * subject-identity-gate.js.
 */

function tokenize(value) {
  if (typeof value !== "string") return [];
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4);
}

function tokensFrom(bags, regionTokens) {
  const tokens = new Set();
  for (const item of bags) {
    for (const token of tokenize(String(item))) {
      if (regionTokens.has(token)) continue;
      tokens.add(token);
    }
  }
  return tokens;
}

function regionTokenSet(fields = {}) {
  const regionTokens = new Set();
  for (const region of fields.regions || []) {
    for (const token of tokenize(String(region))) regionTokens.add(token);
  }
  return regionTokens;
}

function countOverlap(articleText, contextTokens) {
  const articleTokens = new Set(tokenize(articleText));
  let hits = 0;
  const matched = [];
  for (const token of articleTokens) {
    if (contextTokens.has(token)) {
      hits += 1;
      if (matched.length < 8) matched.push(token);
    }
  }
  return { hits, matched };
}

/**
 * True when title/summary shares product/industry tokens, or ≥2 topic/priority/goal
 * tokens, with company_context.fields. Used only to label market vs unrelated —
 * never to demote or continue on its own.
 */
function hasIndustryPriorityOverlap(fields, title, summary) {
  const regions = regionTokenSet(fields);
  const productIndustry = tokensFrom(
    [].concat(fields.products || [], [fields.industry, fields.sub_industry].filter(Boolean)),
    regions,
  );
  const topicPriority = tokensFrom(
    [].concat(fields.topics || [], fields.priorities || [], fields.goals || []),
    regions,
  );
  const text = `${title || ""}\n${summary || ""}`;
  const pi = countOverlap(text, productIndustry);
  const tp = countOverlap(text, topicPriority);
  return pi.hits >= 1 || tp.hits >= 2;
}

module.exports = {
  tokenize,
  collectContextTokens: (fields) => tokensFrom(
    [].concat(
      fields.products || [],
      fields.topics || [],
      fields.priorities || [],
      fields.goals || [],
      [fields.industry, fields.sub_industry].filter(Boolean),
    ),
    regionTokenSet(fields),
  ),
  countOverlap,
  hasIndustryPriorityOverlap,
};
