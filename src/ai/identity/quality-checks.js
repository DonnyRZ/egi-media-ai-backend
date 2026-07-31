"use strict";

/**
 * Offline quality checks for Luna management-identity drafts.
 * Does not call the model — validates shape and leadership-voice hygiene.
 */

const WE_OUR_US = /\b(we|our|ours|us)\b/i;
const YOU_ARE = /^\s*You are\b/;
const PRODUCT_CATALOG_MARKERS = [
  /\b(product catalog|our products include|we offer|portfolio includes)\b/i,
  /\b(brochure|mission statement|about us)\b/i,
];

function checkManagementIdentityQuality(draft, { fields = null } = {}) {
  const failures = [];
  if (!draft || typeof draft !== "object") {
    return { ok: false, failures: ["draft_missing"] };
  }

  const identity = typeof draft.identity === "string" ? draft.identity.trim() : "";
  const companyName = typeof draft.company_name === "string" ? draft.company_name.trim() : "";
  const lens = typeof draft.lens_summary === "string" ? draft.lens_summary.trim() : "";

  if (!identity) failures.push("identity_empty");
  if (!companyName) failures.push("company_name_empty");
  if (!lens) failures.push("lens_summary_empty");

  if (identity && !YOU_ARE.test(identity)) {
    failures.push("identity_must_start_with_you_are");
  }
  if (identity && WE_OUR_US.test(identity)) {
    failures.push("identity_uses_we_our_us");
  }
  if (lens && WE_OUR_US.test(lens)) {
    failures.push("lens_uses_we_our_us");
  }
  for (const marker of PRODUCT_CATALOG_MARKERS) {
    if (identity && marker.test(identity)) {
      failures.push("identity_looks_like_product_catalog");
      break;
    }
  }

  const contextName = typeof fields?.name === "string" ? fields.name.trim() : "";
  if (contextName && companyName) {
    const expected = contextName.toLowerCase();
    const actual = companyName.toLowerCase();
    if (!actual.includes(expected) && !expected.includes(actual)) {
      failures.push("company_name_mismatch");
    }
  }

  // Soft length bounds — leadership persona, not a brochure dump.
  if (identity.length > 1200) failures.push("identity_too_long");
  if (lens.length > 400) failures.push("lens_too_long");

  return { ok: failures.length === 0, failures };
}

module.exports = {
  checkManagementIdentityQuality,
  YOU_ARE,
  WE_OUR_US,
};
