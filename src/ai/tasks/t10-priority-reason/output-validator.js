const { AiOutputError } = require("../../provider/provider.errors");

function validateT10Output(data, { claimIds }) {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).length !== 2 || typeof data.reason !== "string"
    || !data.reason.trim() || data.reason.length > 500 || !Array.isArray(data.source_claim_ids)
    || data.source_claim_ids.length < 1 || data.source_claim_ids.length > 6) throw invalid();
  const seen = new Set();
  for (const claimId of data.source_claim_ids) {
    if (typeof claimId !== "string" || !claimIds.has(claimId) || seen.has(claimId)) throw invalid();
    seen.add(claimId);
  }
  return { reason: data.reason.trim(), sourceClaimIds: [...data.source_claim_ids] };
}

function invalid() {
  return new AiOutputError("T10 must return one bounded reason and unique source claim IDs from the validated T07/T08 claim set", { code: "AI_OUTPUT_SCHEMA_INVALID" });
}

module.exports = { validateT10Output };
