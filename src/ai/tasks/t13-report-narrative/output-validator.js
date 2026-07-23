const { AiOutputError } = require("../../provider/provider.errors");

function validateT13Output(data, { report }) {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 5 || !nonEmpty(data.executive_summary, 1600)
    || !Array.isArray(data.issue_narratives) || !data.impact_narrative || !Array.isArray(data.watch_items) || !Array.isArray(data.source_references)) throw invalid();
  const items = new Map(report.selectedIssuePack.map((item) => [item.reportItemId, item]));
  if (data.issue_narratives.length !== items.size || data.watch_items.length < 1 || data.watch_items.length > 12 || data.source_references.length < 1 || data.source_references.length > 60) throw invalid();
  const claimSources = claimSourceMap(report);
  const usedClaimIds = new Set(); const usedItemIds = new Set();
  for (const item of data.issue_narratives) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== 3 || !items.has(item.report_item_id) || usedItemIds.has(item.report_item_id) || !nonEmpty(item.narrative, 1200)) throw invalid();
    const itemClaimIds = new Set(items.get(item.report_item_id).claims.map((claim) => claim.claimId));
    addCitations(item.source_claim_ids, itemClaimIds, usedClaimIds);
    usedItemIds.add(item.report_item_id);
  }
  if (usedItemIds.size !== items.size || !validCitedText(data.impact_narrative, claimSources, usedClaimIds) || data.watch_items.some((item) => !validCitedText(item, claimSources, usedClaimIds))) throw invalid();
  const refsByClaim = new Map();
  for (const ref of data.source_references) {
    if (!ref || typeof ref !== "object" || Array.isArray(ref) || Object.keys(ref).length !== 2 || typeof ref.claim_id !== "string" || typeof ref.source_article_id !== "string" || !claimSources.get(ref.claim_id)?.has(ref.source_article_id)) throw invalid();
    if (!refsByClaim.has(ref.claim_id)) refsByClaim.set(ref.claim_id, new Set());
    refsByClaim.get(ref.claim_id).add(ref.source_article_id);
  }
  if ([...usedClaimIds].some((claimId) => !refsByClaim.has(claimId))) throw invalid();
  return {
    executiveSummary: data.executive_summary.trim(),
    issueNarratives: data.issue_narratives.map((item) => ({ reportItemId: item.report_item_id, narrative: item.narrative.trim(), sourceClaimIds: [...item.source_claim_ids] })),
    impactNarrative: normalizeCitedText(data.impact_narrative), watchItems: data.watch_items.map(normalizeCitedText),
    sourceReferences: data.source_references.map((ref) => ({ claimId: ref.claim_id, sourceArticleId: ref.source_article_id })),
  };
}
function validCitedText(value, claimSources, used) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 || !nonEmpty(value.narrative, 1200)) return false; try { addCitations(value.source_claim_ids, claimSources, used); return true; } catch { return false; } }
function addCitations(ids, allowed, used) { if (!Array.isArray(ids) || ids.length < 1 || ids.length > 12) throw invalid(); const seen = new Set(); for (const id of ids) { if (typeof id !== "string" || !allowed.has(id) || seen.has(id)) throw invalid(); seen.add(id); used.add(id); } }
function claimSourceMap(report) { const map = new Map(); for (const item of report.selectedIssuePack) for (const claim of item.claims) { if (map.has(claim.claimId)) throw invalid(); map.set(claim.claimId, new Set(claim.sourceArticleIds)); } return map; }
function nonEmpty(value, max) { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function normalizeCitedText(value) { return { narrative: value.narrative.trim(), sourceClaimIds: [...value.source_claim_ids] }; }
function invalid() { return new AiOutputError("T13 must use only the selected report items, bounded sections, and valid claim/article citation subsets", { code: "AI_OUTPUT_SCHEMA_INVALID" }); }
module.exports = { validateT13Output };
