"use strict";

const { isContinuingRelevance } = require("./relevance-policy");
const { applyContextOverlapGate, tokenize } = require("./context-overlap-gate");

const SUBJECT_RELATIONS = Object.freeze(["self", "competitor", "market", "unrelated"]);
const STOP_WORDS = new Set([
  "indonesia", "group", "holding", "company", "persero", "limited", "ltd", "inc",
  "pt", "tbk", "the", "and", "atau", "dengan", "untuk", "dalam", "yang", "dari",
  "pada", "sebuah", "adalah", "akan", "juga", "ini", "itu", "their", "this",
]);

/**
 * Deterministic identity gate: who the article is about relative to company_context.fields.
 * Industry/product token overlap alone MUST NOT create issues — that is "market".
 */
function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s&+]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function distinctiveTokens(phrase) {
  return tokenize(phrase).filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
}

function aliasesFromName(name) {
  if (!name || typeof name !== "string") return [];
  const aliases = new Set();
  const raw = name.trim();
  if (!raw) return [];
  aliases.add(raw);
  const paren = raw.match(/\(([^)]+)\)/g) || [];
  for (const p of paren) aliases.add(p.replace(/[()]/g, "").trim());
  for (const part of raw.split(/[|/–,;]+/)) {
    const cleaned = part.replace(/[()]/g, " ").trim();
    if (cleaned.length >= 3) aliases.add(cleaned);
  }
  // Strip common legal prefixes for shorter distinctive forms.
  const stripped = raw
    .replace(/\b(PT|TBK|Ltd|Limited|Inc|Corp|Corporation|Group|Holding)\b\.?/gi, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length >= 3) aliases.add(stripped);
  return [...aliases].filter(Boolean);
}

function collectSelfAliases(fields = {}) {
  // Identity is anchored on company name aliases only. Generic product/category
  // phrases from products[] must not become self aliases (they cause peer-industry
  // false positives). Named brands belong in the name field or competitors list.
  return aliasesFromName(fields.name);
}

function collectCompetitorAliases(fields = {}) {
  const aliases = new Set();
  for (const competitor of fields.competitors || []) {
    for (const alias of aliasesFromName(String(competitor))) aliases.add(alias);
  }
  return [...aliases];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasContiguousTokenSequence(textTokens, needleTokens) {
  if (!needleTokens.length || textTokens.length < needleTokens.length) return false;
  outer: for (let i = 0; i <= textTokens.length - needleTokens.length; i += 1) {
    for (let j = 0; j < needleTokens.length; j += 1) {
      if (textTokens[i + j] !== needleTokens[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Entity alias match: contiguous whole-phrase or ordered contiguous whole-word
 * distinctive-token sequence. Bag-of-tokens and substring includes are forbidden
 * (they false-positive peer names that share scattered tokens).
 */
function phraseHitsText(phrase, textNorm) {
  const phraseNorm = normalizeText(phrase);
  if (!phraseNorm || phraseNorm.length < 3) return false;
  // Whole-phrase with word boundaries (spaces already normalized).
  const phraseRe = new RegExp(`(?:^|\\s)${escapeRegex(phraseNorm)}(?:\\s|$)`);
  if (phraseRe.test(textNorm)) return true;

  const tokens = distinctiveTokens(phrase);
  if (tokens.length === 0) return false;
  const textTokens = textNorm.split(/\s+/).filter(Boolean);
  // Single distinctive token (≥6 chars): whole-word only.
  if (tokens.length === 1) {
    return tokens[0].length >= 6 && textTokens.includes(tokens[0]);
  }
  // Multi-token: ordered contiguous whole-word sequence only.
  return hasContiguousTokenSequence(textTokens, tokens);
}

function findAliasHits(aliases, title, summary) {
  const textNorm = normalizeText(`${title || ""}\n${summary || ""}`);
  const matched = [];
  for (const alias of aliases) {
    if (phraseHitsText(alias, textNorm)) {
      matched.push(alias);
      if (matched.length >= 6) break;
    }
  }
  return { hits: matched.length, matched, textNorm };
}

function industryOverlapPresent(fields, title, summary) {
  const overlap = applyContextOverlapGate({
    relevance: "medium",
    confidence: 0.5,
    fields,
    title,
    summary,
  });
  return !overlap.gated && (overlap.hits || 0) >= 1;
}

/**
 * Correct subject_relation using entity evidence from company_context.fields.
 * Never hard-codes a brand/industry — only runtime context fields.
 */
function applySubjectIdentityGate({
  relevance,
  confidence,
  subjectRelation,
  fields = {},
  title,
  summary,
}) {
  const competitors = Array.isArray(fields.competitors) ? fields.competitors : [];
  const competitorOptIn = competitors.length > 0;
  const selfHits = findAliasHits(collectSelfAliases(fields), title, summary);
  const competitorHits = competitorOptIn
    ? findAliasHits(collectCompetitorAliases(fields), title, summary)
    : { hits: 0, matched: [] };

  let nextRelation = SUBJECT_RELATIONS.includes(subjectRelation) ? subjectRelation : "unrelated";
  let nextRelevance = relevance;
  let nextConfidence = typeof confidence === "number" ? confidence : 0.5;
  let gated = false;
  let reason = null;

  if (selfHits.hits > 0) {
    nextRelation = "self";
  } else if (competitorHits.hits > 0) {
    nextRelation = "competitor";
  } else if (nextRelation === "self" || nextRelation === "competitor") {
    // LLM claimed entity identity without lexical entity evidence → demote.
    gated = true;
    if (industryOverlapPresent(fields, title, summary)) {
      nextRelation = "market";
      reason = "claimed_entity_without_name_match_market";
    } else {
      nextRelation = "unrelated";
      reason = "claimed_entity_without_name_match_unrelated";
    }
    if (isContinuingRelevance(nextRelevance)) {
      nextRelevance = nextRelation === "market" ? "low" : "none";
      nextConfidence = Math.min(nextConfidence, 0.49);
    }
  } else if (nextRelation === "market" || nextRelation === "unrelated") {
    // Keep; optionally refine market vs unrelated via overlap.
    if (nextRelation === "unrelated" && industryOverlapPresent(fields, title, summary)) {
      nextRelation = "market";
    }
  } else if (industryOverlapPresent(fields, title, summary)) {
    nextRelation = "market";
  } else {
    nextRelation = "unrelated";
  }

  // Market/unrelated must never remain a continuing relevance class.
  if ((nextRelation === "market" || nextRelation === "unrelated") && isContinuingRelevance(nextRelevance)) {
    gated = true;
    reason = reason || (nextRelation === "market" ? "market_subject_blocks_issue" : "unrelated_subject_blocks_issue");
    nextRelevance = nextRelation === "market" ? "low" : "none";
    nextConfidence = Math.min(nextConfidence, 0.49);
  }

  // Competitor without opt-in list cannot form issues — treat as market if industry-ish else unrelated.
  if (nextRelation === "competitor" && !competitorOptIn) {
    gated = true;
    reason = "competitor_without_opt_in_list";
    nextRelation = industryOverlapPresent(fields, title, summary) ? "market" : "unrelated";
    if (isContinuingRelevance(nextRelevance)) {
      nextRelevance = nextRelation === "market" ? "low" : "none";
      nextConfidence = Math.min(nextConfidence, 0.49);
    }
  }

  return {
    relevance: nextRelevance,
    confidence: nextConfidence,
    subjectRelation: nextRelation,
    competitorOptIn,
    gated,
    reason,
    selfHits: selfHits.matched,
    competitorHits: competitorHits.matched,
  };
}

module.exports = {
  SUBJECT_RELATIONS,
  aliasesFromName,
  collectSelfAliases,
  collectCompetitorAliases,
  findAliasHits,
  applySubjectIdentityGate,
};
