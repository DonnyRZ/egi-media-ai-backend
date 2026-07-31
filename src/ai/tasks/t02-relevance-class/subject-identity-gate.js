"use strict";

const { isContinuingRelevance } = require("./relevance-policy");
const { hasIndustryPriorityOverlap, tokenize } = require("./context-overlap-gate");

const SUBJECT_RELATIONS = Object.freeze(["self", "competitor", "market", "unrelated"]);
const STOP_WORDS = new Set([
  "indonesia", "group", "holding", "company", "persero", "limited", "ltd", "inc",
  "pt", "tbk", "the", "and", "atau", "dengan", "untuk", "dalam", "yang", "dari",
  "pada", "sebuah", "adalah", "akan", "juga", "ini", "itu", "their", "this",
]);

/**
 * Deterministic identity gate: who the article is about relative to company_context.fields.
 * Industry/product token overlap alone MUST NOT create issues — that is "market".
 * Self evidence: name + brands_aliases + key_people (runtime fields only).
 * Match surface: title + summary + optional body (recall for body-only mentions).
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

function cleanBody(value, maxChars = 4000) {
  if (typeof value !== "string" || !value) return "";
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, maxChars);
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
  const stripped = raw
    .replace(/\b(PT|TBK|Ltd|Limited|Inc|Corp|Corporation|Group|Holding)\b\.?/gi, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length >= 3) aliases.add(stripped);
  return [...aliases].filter(Boolean);
}

function collectSelfAliases(fields = {}) {
  const aliases = new Set(aliasesFromName(fields.name));
  for (const brand of fields.brands_aliases || []) {
    const raw = String(brand || "").trim();
    if (!raw) continue;
    aliases.add(raw);
    for (const a of aliasesFromName(raw)) aliases.add(a);
  }
  for (const person of fields.key_people || []) {
    const raw = String(person || "").trim();
    if (!raw) continue;
    aliases.add(raw);
    for (const a of aliasesFromName(raw)) aliases.add(a);
  }
  return [...aliases];
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
 * distinctive-token sequence. Bag-of-tokens and substring includes are forbidden.
 */
function phraseHitsText(phrase, textNorm) {
  const phraseNorm = normalizeText(phrase);
  if (!phraseNorm || phraseNorm.length < 3) return false;
  const phraseRe = new RegExp(`(?:^|\\s)${escapeRegex(phraseNorm)}(?:\\s|$)`);
  if (phraseRe.test(textNorm)) return true;

  const tokens = distinctiveTokens(phrase);
  if (tokens.length === 0) return false;
  const textTokens = textNorm.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return tokens[0].length >= 6 && textTokens.includes(tokens[0]);
  }
  return hasContiguousTokenSequence(textTokens, tokens);
}

function findAliasHits(aliases, title, summary, body = "") {
  const textNorm = normalizeText(`${title || ""}\n${summary || ""}\n${cleanBody(body)}`);
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
  return hasIndustryPriorityOverlap(fields, title, summary);
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
  body = "",
}) {
  const competitors = Array.isArray(fields.competitors) ? fields.competitors : [];
  // Persisted as competitorOptIn for API/DB compat: true when competitors[] is non-empty.
  // Not a product feature flag — unlisted peers become "market", not blocked.
  const competitorOptIn = competitors.length > 0;
  const selfHits = findAliasHits(collectSelfAliases(fields), title, summary, body);
  const competitorHits = competitorOptIn
    ? findAliasHits(collectCompetitorAliases(fields), title, summary, body)
    : { hits: 0, matched: [] };

  const combinedLen = `${title || ""} ${summary || ""} ${cleanBody(body)}`.replace(/\s+/g, " ").trim().length;
  if (combinedLen < 48 && selfHits.hits === 0 && competitorHits.hits === 0) {
    return {
      relevance: "none",
      confidence: Math.min(typeof confidence === "number" ? confidence : 0.5, 0.4),
      subjectRelation: "unrelated",
      competitorOptIn,
      gated: true,
      reason: "content_too_thin_for_identity",
      selfHits: [],
      competitorHits: [],
    };
  }

  let nextRelation = SUBJECT_RELATIONS.includes(subjectRelation) ? subjectRelation : "unrelated";
  let nextRelevance = relevance;
  let nextConfidence = typeof confidence === "number" ? confidence : 0.5;
  let gated = false;
  let reason = null;

  if (selfHits.hits > 0) {
    // Identity evidence corrects relation only. Relevance remains the model's
    // materiality judgment; merely naming a company must not force an issue.
    nextRelation = "self";
  } else if (competitorHits.hits > 0) {
    nextRelation = "competitor";
  } else if (nextRelation === "self" || nextRelation === "competitor") {
    // A claimed entity without lexical evidence is an external market signal
    // when it materially overlaps context. Keep its relevance; relation drives
    // the correct management framing downstream.
    gated = true;
    if (industryOverlapPresent(fields, title, summary)) {
      nextRelation = "market";
      reason = "claimed_entity_without_name_match_market";
    } else {
      nextRelation = "unrelated";
      reason = "claimed_entity_without_name_match_unrelated";
    }
    if (nextRelation === "unrelated" && isContinuingRelevance(nextRelevance)) {
      nextRelevance = "none";
      nextConfidence = Math.min(nextConfidence, 0.49);
    }
  } else if (nextRelation === "market" || nextRelation === "unrelated") {
    // Preserve a consensus market classification. Semantic regulations and
    // macro signals often use no literal product token. Lexical overlap may
    // upgrade unrelated→market, but absence of overlap must not erase market.
    if (nextRelation === "unrelated" && industryOverlapPresent(fields, title, summary)) {
      nextRelation = "market";
    }
  } else if (industryOverlapPresent(fields, title, summary)) {
    nextRelation = "market";
  } else {
    nextRelation = "unrelated";
  }

  // Only unrelated content is blocked. A high/medium market signal is useful
  // management intelligence and must continue.
  if (nextRelation === "unrelated" && isContinuingRelevance(nextRelevance)) {
    gated = true;
    reason = reason || "unrelated_subject_blocks_issue";
    nextRelevance = "none";
    nextConfidence = Math.min(nextConfidence, 0.49);
  }

  // An unlisted competitor is a market signal, not irrelevant content.
  if (nextRelation === "competitor" && !competitorOptIn) {
    gated = true;
    reason = "competitor_without_listed_peers";
    nextRelation = industryOverlapPresent(fields, title, summary) ? "market" : "unrelated";
    if (nextRelation === "unrelated" && isContinuingRelevance(nextRelevance)) {
      nextRelevance = "none";
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
  cleanBody,
  applySubjectIdentityGate,
};
