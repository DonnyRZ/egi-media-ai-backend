"use strict";

/**
 * Deterministic pre-AI content quality gate.
 *
 * Baseline evidence (Arunika, 2026-07-28): bodies of 23 / 118 / 184 chars were
 * snapshotted and enqueued into T02+, and low-relevance paths created issues.
 * Substantial bodies (>= ~1000 clean chars) are the normal crawl shape.
 * Threshold is set from that distribution, not an arbitrary round number alone.
 */
const MIN_CLEAN_CONTENT_CHARS = 400;

const PLACEHOLDER_PATTERNS = Object.freeze([
  /\blorem\s+ipsum\b/i,
  /\bplaceholder\b/i,
  /\bcoming\s+soon\b/i,
  /\bkonten\s+tidak\s+tersedia\b/i,
  /\bcontent\s+not\s+available\b/i,
  /\benable\s+javascript\b/i,
  /\bjavascript\s+is\s+(required|disabled)\b/i,
  /\bsilakan\s+aktifkan\s+javascript\b/i,
  /\bsubscribe\s+to\s+continue\s+reading\b/i,
  /\blog\s*in\s+to\s+(read|continue)\b/i,
]);

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForCompare(value) {
  return cleanText(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function assessArticleContent(article = {}) {
  const title = cleanText(article.title);
  const summary = cleanText(article.summary);
  const content = cleanText(article.content);
  const details = {
    titleLength: title.length,
    summaryLength: summary.length,
    contentLength: content.length,
    minCleanContentChars: MIN_CLEAN_CONTENT_CHARS,
  };

  if (!content) {
    return { ok: false, reason: "content_empty", details };
  }

  const normalizedTitle = normalizeForCompare(title);
  const normalizedContent = normalizeForCompare(content);
  if (normalizedTitle && normalizedContent && (
    normalizedTitle === normalizedContent
    || (normalizedContent.length <= Math.max(normalizedTitle.length + 8, 48) && normalizedContent.includes(normalizedTitle))
  )) {
    return { ok: false, reason: "title_equals_body", details };
  }

  const haystack = `${title}\n${summary}\n${content}`;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(haystack)) {
      return { ok: false, reason: "placeholder_content", details: { ...details, pattern: String(pattern) } };
    }
  }

  if (content.length < MIN_CLEAN_CONTENT_CHARS) {
    return { ok: false, reason: "content_too_thin", details };
  }

  return { ok: true, reason: null, details };
}

module.exports = {
  MIN_CLEAN_CONTENT_CHARS,
  PLACEHOLDER_PATTERNS,
  cleanText,
  assessArticleContent,
};
