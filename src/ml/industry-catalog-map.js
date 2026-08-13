"use strict";

/**
 * Map free-text Company Context industry/sub_industry to a catalog id.
 * Unmapped values return null (fail-open: T02 still runs).
 * More specific industries are matched before IT so "digital banking" is not IT.
 */

const CATALOG = Object.freeze([
  {
    id: "hospitality",
    patterns: [
      /\bhospitality\b/i,
      /\bperhotelan\b/i,
      /\bhotel\b/i,
      /\bresort\b/i,
      /\blodging\b/i,
      /\bakomodasi\b/i,
      /\baccommodation\b/i,
      /\btourism\b/i,
      /\bpariwisata\b/i,
      /\brestaurant\b/i,
      /\brestoran\b/i,
      /\bdining\b/i,
      /\bf\s*&\s*b\b/i,
    ],
  },
  {
    id: "banking",
    patterns: [
      /\bbanking\b/i,
      /\bbank\b/i,
      /\bfintech\b/i,
      /\bpayments?\b/i,
      /\bpembayaran\b/i,
      /\bfinancial services\b/i,
      /\blayanan keuangan\b/i,
      /\bdigital financial\b/i,
    ],
  },
  {
    id: "healthcare",
    patterns: [
      /\bhealthcare\b/i,
      /\bkesehatan\b/i,
      /\bhospital\b/i,
      /\brumah sakit\b/i,
      /\bpharma\b/i,
      /\bfarmasi\b/i,
      /\bclinical\b/i,
      /\bklinis\b/i,
    ],
  },
  {
    id: "energy",
    patterns: [
      /\benergy\b/i,
      /\benergi\b/i,
      /\boil\b/i,
      /\bgas\b/i,
      /\bpower\b/i,
      /\blistrik\b/i,
      /\brenewable\b/i,
      /\butilities\b/i,
    ],
  },
  {
    id: "transportation",
    patterns: [
      /\btransport\b/i,
      /\blogistics\b/i,
      /\blogistik\b/i,
      /\bfreight\b/i,
      /\bshipping\b/i,
      /\baviation\b/i,
      /\bmobility\b/i,
      /\bpelabuhan\b/i,
    ],
  },
  {
    id: "food_agriculture",
    patterns: [
      /\bagriculture\b/i,
      /\bpertanian\b/i,
      /\bplantation\b/i,
      /\bperkebunan\b/i,
      /\bfisheries\b/i,
      /\bperikanan\b/i,
      /\bfood processing\b/i,
      /\bpangan\b/i,
    ],
  },
  {
    id: "manufacturing",
    patterns: [
      /\bmanufactur\b/i,
      /\bpabrik\b/i,
      /\bfactory\b/i,
      /\bindustrial components\b/i,
      /\bmachinery\b/i,
      /\botomotif\b/i,
      /\bautomotive\b/i,
    ],
  },
  {
    id: "it",
    patterns: [
      /\binformation technology\b/i,
      /\bteknologi informasi\b/i,
      /\bit services\b/i,
      /\blayanan it\b/i,
      /\btechnology services\b/i,
      /\benterprise software\b/i,
      /\benterprise technology\b/i,
      /\bmanaged it\b/i,
      /\bcybersecurity\b/i,
      /\bcyber security\b/i,
      /\bkeamanan siber\b/i,
      /\bcloud computing\b/i,
      /\bcloud services\b/i,
      /\bdata centers?\b/i,
      /\bpusat data\b/i,
      /\bsoftware\b/i,
      /\bsaas\b/i,
      /\bdigital platforms?\b/i,
      /(^|[^a-z])it([^a-z]|$)/i,
    ],
  },
]);

function mapIndustry(fields = {}) {
  const blob = `${fields.industry || ""} ${fields.sub_industry || ""}`.trim();
  if (!blob) return null;
  for (const entry of CATALOG) {
    if (entry.patterns.some((pattern) => pattern.test(blob))) return entry.id;
  }
  return null;
}

module.exports = { CATALOG, mapIndustry };
