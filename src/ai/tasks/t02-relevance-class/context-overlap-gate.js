"use strict";

const { isContinuingRelevance } = require("./relevance-policy");

/**
 * Deterministic post-T02 gate: continuing classes must share a real lexical hook
 * with company_context_fields. Prevents generic-news "medium" from opening issues
 * without baking any industry into prompts.
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

function applyContextOverlapGate({ relevance, confidence, fields, title, summary }) {
  if (!isContinuingRelevance(relevance)) {
    return { relevance, confidence, gated: false, reason: null };
  }
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
  // Product/industry: one solid hook is enough. Topics/priorities alone need two
  // (avoids single generic tokens like "energi" / "efisiensi" opening issues).
  if (pi.hits >= 1 || tp.hits >= 2) {
    return {
      relevance,
      confidence,
      gated: false,
      reason: null,
      hits: pi.hits + tp.hits,
      matched: [...pi.matched, ...tp.matched].slice(0, 8),
    };
  }
  return {
    relevance: "low",
    confidence: Math.min(typeof confidence === "number" ? confidence : 0.5, 0.49),
    gated: true,
    reason: "no_company_context_field_overlap",
    hits: pi.hits + tp.hits,
    matched: [...pi.matched, ...tp.matched].slice(0, 8),
  };
}

module.exports = {
  tokenize,
  collectContextTokens: (fields) => tokensFrom(
    [].concat(fields.products || [], fields.topics || [], fields.priorities || [], fields.goals || [], [fields.industry, fields.sub_industry].filter(Boolean)),
    regionTokenSet(fields),
  ),
  countOverlap,
  applyContextOverlapGate,
};
