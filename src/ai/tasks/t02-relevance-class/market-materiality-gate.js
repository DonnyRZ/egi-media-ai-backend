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

// Broad capability terms are useful for semantic routing but are not, by
// themselves, a product or operating exposure. Keep this industry-neutral so
// a shared word such as "digital" cannot upgrade an unrelated sub-sector.
const GENERIC_CAPABILITY_TOKENS = new Set([
  "digital", "technology", "technologies", "teknologi", "innovation", "inovasi",
  "transformasi", "transformation", "platform", "platforms", "software", "perangkat",
  "solution", "solutions", "solusi", "service", "services", "layanan", "system", "systems",
  "data", "engineering", "operations", "operational", "managed", "management", "industry",
  "industri", "business", "bisnis", "customer", "customers", "pelanggan",
]);

const MACRO_CUSTOMER_SIGNAL_RE = /\b(kredit|credit|loan|pinjaman|suku\s+bunga|interest\s+rate|inflasi|inflation|daya\s+beli|purchasing\s+power|investasi|investment|business\s+confidence|dunia\s+usaha)\b/i;

/**
 * Generic event bridges for cases where the model is conservative but the
 * article contains a concrete management event that directly matches a
 * company risk, product, dependency, or priority. These are event/context
 * semantics only; they do not contain a brand, industry, or pilot-company
 * rule.
 */
const CONTEXT_EVENT_BRIDGES = Object.freeze([
  {
    hook: "context_safety_or_disruption_event",
    context: /\b(safety|keselamatan|security|keamanan|resilience|resil|disruption|disrupsi|business\s+continuity|transport|logistics|freight|carrier|supply\s+chain|critical\s+utilities|operational\s+capacity|patient\s+safety|clinical\s+governance)\b/i,
    article: /\b(kecelakaan|accident|insiden|incident|tewas|meninggal|serangan|gangguan|disruption|bab\s+al[- ]?mandab|red\s+sea|maritim|maritime|shipping|lintasan\s+ka|rail\s+crossing|dokter|perawat|internship|tenaga\s+kesehatan|burnout)\b/i,
  },
  {
    hook: "context_regulatory_quality_event",
    context: /\b(regulat|compliance|kepatuhan|governance|tata\s+kelola|quality|kualitas|traceability|ketertelusuran|food\s+safety|keamanan\s+pangan|customs|kepabeanan|licensing|perizinan|accreditation|akreditasi|standar|standard|assurance|audit)\b/i,
    article: /\b(audit|pelanggaran|bermasalah|bermasalahnya|mandat|regulasi|regulation|peraturan|sertifikasi|certification|verifikasi|verification|standar|standard|lisensi|izin|pajak|bpjs|fortifikasi|fortified|beras|rice|dapur)\b/i,
  },
  {
    hook: "context_environmental_or_utility_disruption",
    context: /\b(critical\s+utilities|water|air|climate|iklim|crop|tanaman|energy|energi|power|listrik)\b/i,
    article: /\b(kekeringan|drought|krisis\s+listrik|power\s+crisis|gangguan\s+listrik|water\s+shortage|kekurangan\s+air)\b/i,
  },
  {
    hook: "context_cost_supply_energy_change",
    context: /\b(cost|biaya|price|harga|procurement|pengadaan|supply|pasokan|logistics|logistik|energy|energi|power|listrik|fuel|bahan\s+bakar|transport|schedule|procurement\s+delay)\b/i,
    article: /\b(bb[mn]|bahan\s+bakar|fuel|energy|energi|listrik|electricity|harga|price|biaya|cost|pasokan|supply|shipping|freight|logistik)\b/i,
    change: /\b(naik|turun|tinggi|rendah|melonjak|merosot|berubah|tetap|berpotensi|potensi|tekanan|krisis|disruption|disrupsi|hingga|sampai)\b/i,
  },
  {
    hook: "context_digital_payment_product_change",
    context: /\b(payment|pembayaran|qris|mobile|digital\s+banking|onboarding|merchant|platform|api|transaction|transaksi)\b/i,
    article: /\b(qris|pembayaran|payment|transaksi|transaction|mobile\s+banking|digital\s+banking)\b/i,
    change: /\b(bisa\s+pakai|meluas|meningkat|melonjak|ekspansi|expansion|antar\s+negara|cross[- ]border|diluncurkan|launch|tersedia|available)\b/i,
  },
  {
    hook: "context_clinical_technology_or_reimbursement_change",
    context: /\b(surgery|bedah|clinical|klinis|diagnostic|diagnostik|healthcare|kesehatan|technology\s+adoption|reimbursement|pembiayaan|patient\s+care)\b/i,
    article: /\b(bedah\s+robotik|robotic\s+surgery|robotik|bpjs|reimbursement|pembiayaan)\b/i,
  },
  {
    hook: "context_food_safety_or_product_quality_event",
    context: /\b(food\s+and\s+product\s+safety|food\s+safety|keamanan\s+pangan|product\s+safety|consumer\s+safety|supplier\s+quality|quality\s+systems?|kualitas|traceability|ketertelusuran|nutrition|wellness)\b/i,
    article: /\b(mual|keracunan|keracunan\s+makanan|sakit|terdampak|terkontaminasi|kontaminasi|ditarik|penarikan|recall|keluhan|kualitas\s+pangan|keamanan\s+pangan)\b/i,
  },
  {
    hook: "context_platform_content_liability_event",
    context: /\b(content\s+responsibility|content\s+liability|rights\s+management|moderation|age\s+controls|advertising\s+standards|digital\s+platforms?|messaging|media\s+and\s+content|lawful\s+obligations|regulatory\s+compliance)\b/i,
    article: /\b(telegram|whatsapp|platform|aplikasi\s+pesan|messaging|media\s+sosial|digital\s+platform)\b/i,
    change: /\b(tersangka|teror|terror|terorisme|penangkapan|ditangkap|tuduhan|investigasi|penyelidikan|diblokir|pelanggaran|denda|regulator|pemerintah|pengawasan)\b/i,
  },
  {
    hook: "context_digital_platform_product_change",
    context: /\b(digital\s+platforms?|mobile|messaging|customer\s+experience|digital\s+services?|technology\s+innovation|platforms?|aplikasi)\b/i,
    article: /\b(whatsapp|telegram|platform|aplikasi\s+pesan|messaging|digital\s+platform)\b/i,
    change: /\b(uji|menguji|fitur|folder|diluncurkan|meluncurkan|launch|tersedia|available|perubahan|update|pembaruan)\b/i,
  },
  {
    hook: "context_climate_environmental_policy_change",
    context: /\b(climate|iklim|environment|lingkungan|sustainability|keberlanjutan|regenerative|water\s+stewardship|nature|environmental\s+performance)\b/i,
    article: /\b(iklim|climate|lingkungan|environment|perubahan\s+iklim|perlindungan\s+lingkungan)\b/i,
    change: /\b(kerja\s+sama|kerjasama|perjanjian|kebijakan|policy|target|investasi|program|kesepakatan|perlindungan)\b/i,
  },
  {
    hook: "context_education_funding_or_access_change",
    context: /\b(education|pendidikan|learner|student|scholarship|beasiswa|access|affordability|learning|akademik|kampus|sekolah)\b/i,
    article: /\b(pendidikan|edukasi|beasiswa|anggaran\s+pendidikan|sekolah|kampus|mahasiswa|siswa|makan\s+bergizi)\b/i,
    change: /\b(anggaran|budget|20\s*persen|putusan|kebijakan|policy|skema|alokasi|dana|beasiswa|wajib|dibahas)\b/i,
    exclude: /\b(mbg|makan\s+bergizi\s+gratis)\b/i,
  },
  {
    hook: "context_urban_water_infrastructure_project",
    context: /\b(water|air|utilities|urban|transport|infrastructure|infrastruktur|flood|banjir|drainage|drainase|public\s+works)\b/i,
    article: /\b(ruang\s+terbuka\s+biru|sungai|waduk|embung|pengendalian\s+banjir|drainase|stasiun|kereta|infrastruktur\s+air)\b/i,
    change: /\b(pengembangan|mengembangkan|pembangunan|membangun|memperluas|perluas|meresmikan|pemugaran|proyek|infrastruktur)\b/i,
  },
]);

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
    article: /\b(payment|pembayaran|qris|fintech|merchant|bank|mobile\s+banking|digital\s+banking)\b/i,
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
    .concat(fields.products || [], fields.topics || [], fields.priorities || [], fields.goals || [], fields.risks || [], fields.dependencies || [])
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
      if (!regions.has(token) && !GENERIC_CAPABILITY_TOKENS.has(token)) tokens.add(token);
    }
  }
  return tokens;
}

function hasEnterpriseCustomer(fields = {}) {
  return [].concat(fields.customers || [], fields.products || [], fields.priorities || [])
    .some((item) => /enterprise|corporate|business|commercial|sme|umkm|perusahaan|usaha/i.test(String(item)));
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

function contextEventBridge(fields, text) {
  const context = fieldBlob({
    ...fields,
    risks: fields.risks || [],
  });
  for (const bridge of CONTEXT_EVENT_BRIDGES) {
    if (!bridge.context.test(context) || !bridge.article.test(text)) continue;
    if (bridge.exclude?.test(text)) continue;
    if (bridge.change && !bridge.change.test(text)) continue;
    return { hook: bridge.hook, matched: [] };
  }
  return null;
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
  const macroCustomerSignal = MACRO_CUSTOMER_SIGNAL_RE.test(text) && hasEnterpriseCustomer(fields);
  const eventBridge = contextEventBridge(fields, text);

  if (eventBridge && subjectRelation === "market") {
    if (!isContinuingRelevance(relevance)) {
      return {
        relevance: "medium",
        confidence: Math.max(typeof confidence === "number" ? confidence : 0.5, 0.55),
        gated: true,
        reason: "context_event_bridge_upgrade",
        hook: eventBridge.hook,
        matched: eventBridge.matched,
      };
    }
    return {
      relevance,
      confidence,
      gated: false,
      reason: null,
      hook: eventBridge.hook,
      matched: eventBridge.matched,
    };
  }

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
  if (macroCustomerSignal) {
    return {
      relevance,
      confidence,
      gated: false,
      reason: null,
      hook: "macro_customer_market_signal",
      matched: [],
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
