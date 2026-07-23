const { AiOutputError } = require("../../provider/provider.errors");
const ALLOWED = new Set(["fact", "analysis", "assumption"]);

function validateT08Output(data, { claimIds }) {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 1 || !Array.isArray(data.labels) || data.labels.length !== claimIds.size) throw invalid();
  const labels = new Map();
  for (const item of data.labels) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== 2
      || typeof item.claim_id !== "string" || !claimIds.has(item.claim_id) || !ALLOWED.has(item.label) || labels.has(item.claim_id)) throw invalid();
    labels.set(item.claim_id, item.label);
  }
  if (labels.size !== claimIds.size) throw invalid();
  return { labels: [...labels].map(([claim_id, label]) => ({ claim_id, label })) };
}
function invalid() { return new AiOutputError("T08 must label each existing T07 claim exactly once without adding or rewriting claims", { code: "AI_OUTPUT_SCHEMA_INVALID" }); }
module.exports = { validateT08Output };
