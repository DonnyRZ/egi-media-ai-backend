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

function collectContextTokens(fields = {}, { includeRegions = false } = {}) {
  const bags = []
    .concat(
      fields.products || [],
      fields.topics || [],
      fields.priorities || [],
      fields.goals || [],
      fields.customers || [],
      fields.dependencies || [],
      fields.competitors || [],
      fields.risks || [],
    )
    .concat([fields.industry, fields.sub_industry, fields.description, fields.name].filter(Boolean));
  if (includeRegions) bags.push(...(fields.regions || []));
  const tokens = new Set();
  for (const item of bags) {
    for (const token of tokenize(String(item))) tokens.add(token);
  }
  return tokens;
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
  // Exclude regions-only matches (too broad: city names alone must not open issues).
  const contextTokens = collectContextTokens(fields, { includeRegions: false });
  const { hits, matched } = countOverlap(`${title || ""}\n${summary || ""}`, contextTokens);
  if (hits >= 1) {
    return { relevance, confidence, gated: false, reason: null, hits, matched };
  }
  return {
    relevance: "low",
    confidence: Math.min(typeof confidence === "number" ? confidence : 0.5, 0.49),
    gated: true,
    reason: "no_company_context_field_overlap",
    hits,
    matched,
  };
}

module.exports = {
  tokenize,
  collectContextTokens,
  countOverlap,
  applyContextOverlapGate,
};
