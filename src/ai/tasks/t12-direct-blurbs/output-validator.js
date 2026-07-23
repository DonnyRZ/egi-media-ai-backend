const { AiOutputError } = require("../../provider/provider.errors");

function validateT12Output(data, { claimIds }) {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 3
    || !isBoundedText(data.new_development_blurb) || !isBoundedText(data.short_impact_blurb)
    || !Array.isArray(data.source_claim_ids) || data.source_claim_ids.length < 1 || data.source_claim_ids.length > 6) throw invalid();
  const seen = new Set();
  for (const claimId of data.source_claim_ids) {
    if (typeof claimId !== "string" || !claimIds.has(claimId) || seen.has(claimId)) throw invalid();
    seen.add(claimId);
  }
  return {
    newDevelopmentBlurb: data.new_development_blurb.trim(),
    shortImpactBlurb: data.short_impact_blurb.trim(),
    sourceClaimIds: [...data.source_claim_ids],
  };
}

function isBoundedText(value) { return typeof value === "string" && value.trim().length > 0 && value.length <= 320; }
function invalid() { return new AiOutputError("T12 must return two bounded blurbs and unique source claim IDs from the validated allowed set", { code: "AI_OUTPUT_SCHEMA_INVALID" }); }

module.exports = { validateT12Output };
