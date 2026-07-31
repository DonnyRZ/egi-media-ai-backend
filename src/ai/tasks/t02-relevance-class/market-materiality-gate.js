"use strict";

const { isContinuingRelevance } = require("./relevance-policy");
const { tokenize } = require("./context-overlap-gate");

/**
 * Deterministic market-materiality gate.
 *
 * Continues only when a market-classified article has a direct hook to concrete
 * company_context fields. Topic/priority keyword coincidence alone is never enough.
 *
 * Product-category expansions activate only when those stems already appear in
 * the tenant's products/industry fields (multi-industry safe — no brand bias).
 */

const COMMERCIAL_ACTION_RE = /\b(promo|promosi|diskon|discount|launch|luncur|membuka|dibuka|tutup|penutupan|ekspansi|expansion|harga|price|tarif|direct[\s-]?book|pasar|market|gelar|event|acara|grand\s+opening|akuisisi|acquisition|merger|paket|package|campaign|kampanye)\b/i;

const PROJECT_REG_RE = /\b(infrastruktur|bandara|pelabuhan|regulasi|peraturan|undang[\s-]?undang|pajak|levy|groundbreaking|pembangunan|shortcut|tol|jembatan|kebijakan|policy|duty|tarif\s+impor|import\s+duty|jalan\s+lingkar|ruas\s+jalan|triliun|miliar)\b/i;

/** Accessibility / demand-pressure signals in an operating geography. */
const OPERATING_DEMAND_RE = /\b(pariwisata|tourism|destinasi|destination|wisatawan|visitor|kunjungan|konektivitas|connectivity|kemacetan|aksesibilitas|accessibility|congest)\b/i;

/**
 * Expand product/industry stems already present in company context into common
 * article phrasings. Rules never fire unless the tenant's own fields match `field`.
 */
const PRODUCT_CATEGORY_EXPAND = Object.freeze([
  {
    field: /hotel|resort|lodging|hospitality|perhotelan|penginapan|akomodasi|accommodation/i,
    article: /\b(hotel|resort|penginapan|convention|konvensi|kamar|akomodasi|hospitality|lodging)\b/i,
  },
  {
    field: /restoran|restaurant|dining|food|beverage|kuliner|f\s*&\s*b|kafe|cafe|culin|katering/i,
    article: /\b(restoran|restaurant|rumah\s+makan|kuliner|cafe|kafe|food|beverage|dining|makanan|hidangan)\b/i,
  },
  {
    field: /manufactur|factory|pabrik|industrial|komponen|component|sensor/i,
    article: /\b(pabrik|factory|manufactur|komponen|component|sensor|industri|industrial)\b/i,
  },
  {
    field: /payment|pembayaran|lender|kredit|credit|fintech|merchant|bank/i,
    article: /\b(payment|pembayaran|lender|kredit|credit|fintech|merchant|bank|pinjaman)\b/i,
  },
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldBlob(fields = {}) {
  return []
    .concat(fields.products || [], fields.topics || [], fields.priorities || [], fields.goals || [], fields.dependencies || [])
    .concat([fields.industry, fields.sub_industry, fields.description].filter(Boolean))
    .map((item) => String(item))
    .join("\n");
}

function regionTokens(fields = {}) {
  const tokens = new Set();
  for (const region of fields.regions || []) {
    for (const token of tokenize(String(region))) tokens.add(token);
  }
  return tokens;
}

function productIndustryTokens(fields = {}) {
  const regions = regionTokens(fields);
  const tokens = new Set();
  for (const item of [].concat(fields.products || [], [fields.industry, fields.sub_industry].filter(Boolean))) {
    for (const token of tokenize(String(item))) {
      if (!regions.has(token)) tokens.add(token);
    }
  }
  return tokens;
}

function dependencyPhrases(fields = {}) {
  return (fields.dependencies || [])
    .map((item) => normalizeText(item))
    .filter((item) => item.length >= 8);
}

function countTokenHits(text, tokenSet) {
  const articleTokens = new Set(tokenize(text));
  let hits = 0;
  const matched = [];
  for (const token of articleTokens) {
    if (tokenSet.has(token)) {
      hits += 1;
      if (matched.length < 8) matched.push(token);
    }
  }
  return { hits, matched };
}

function hasRegionHit(text, fields = {}) {
  const norm = normalizeText(text);
  for (const region of fields.regions || []) {
    const phrase = normalizeText(region);
    if (phrase.length >= 4 && norm.includes(phrase)) return true;
  }
  return countTokenHits(text, regionTokens(fields)).hits >= 1;
}

function hasExpandedProductCategoryHit(fields, text) {
  const blob = fieldBlob(fields);
  for (const rule of PRODUCT_CATEGORY_EXPAND) {
    if (rule.field.test(blob) && rule.article.test(text)) return true;
  }
  return false;
}

function hasDependencyHit(fields, text) {
  const norm = normalizeText(text);
  for (const phrase of dependencyPhrases(fields)) {
    const parts = phrase.split(/\s+/).filter((part) => part.length >= 5);
    if (parts.length === 0) continue;
    if (parts.filter((part) => norm.includes(part)).length >= 2) return true;
    if (phrase.length >= 12 && norm.includes(phrase)) return true;
  }
  return false;
}

/**
 * @returns {{ relevance, confidence, gated, reason, hook, matched }}
 */
function applyMarketMaterialityGate({
  relevance,
  confidence,
  subjectRelation,
  fields = {},
  title,
  summary,
}) {
  const text = `${title || ""}\n${summary || ""}`;
  const pi = countTokenHits(text, productIndustryTokens(fields));
  const commercial = COMMERCIAL_ACTION_RE.test(text);
  const project = PROJECT_REG_RE.test(text);
  const region = hasRegionHit(text, fields);
  const productCategory = hasExpandedProductCategoryHit(fields, text);
  const dependency = hasDependencyHit(fields, text);
  const hasOperatingRegions = Array.isArray(fields.regions) && fields.regions.length > 0;

  // Rescue true-positive peer/product moves the model underrates as low/none.
  // Only product/category + commercial action — never region/project upgrades.
  if (
    !isContinuingRelevance(relevance)
    && subjectRelation === "market"
    && ((productCategory && commercial) || (pi.hits >= 1 && commercial))
  ) {
    return {
      relevance: "medium",
      confidence: Math.max(typeof confidence === "number" ? confidence : 0.5, 0.55),
      gated: true,
      reason: "peer_commercial_action_upgrade",
      hook: productCategory && commercial ? "product_category_commercial_action" : "product_industry_overlap",
      matched: pi.matched,
    };
  }

  if (!isContinuingRelevance(relevance) || subjectRelation !== "market") {
    return {
      relevance,
      confidence,
      gated: false,
      reason: null,
      hook: null,
      matched: [],
    };
  }

  if (pi.hits >= 1) {
    return {
      relevance,
      confidence,
      gated: false,
      reason: null,
      hook: "product_industry_overlap",
      matched: pi.matched,
    };
  }
  if (productCategory && commercial) {
    return {
      relevance,
      confidence,
      gated: false,
      reason: null,
      hook: "product_category_commercial_action",
      matched: [],
    };
  }
  if (region && project) {
    return {
      relevance,
      confidence,
      gated: false,
      reason: null,
      hook: "region_project_or_regulation",
      matched: [],
    };
  }
  // Sub-region infrastructure that affects listed operating geographies even
  // when the article names a district not listed verbatim in regions[].
  if (hasOperatingRegions && project && OPERATING_DEMAND_RE.test(text)) {
    return {
      relevance,
      confidence,
      gated: false,
      reason: null,
      hook: "operating_area_infrastructure_demand",
      matched: [],
    };
  }
  if (dependency && (commercial || project)) {
    return {
      relevance,
      confidence,
      gated: false,
      reason: null,
      hook: "dependency_with_change_signal",
      matched: [],
    };
  }

  return {
    relevance: "low",
    confidence: Math.min(typeof confidence === "number" ? confidence : 0.5, 0.49),
    gated: true,
    reason: "market_without_direct_context_hook",
    hook: null,
    matched: pi.matched,
  };
}

module.exports = {
  applyMarketMaterialityGate,
  COMMERCIAL_ACTION_RE,
  PROJECT_REG_RE,
};
