const { AiOutputError } = require("../../provider/provider.errors");

const ALLOWED_SUBJECT = new Set(["self", "competitor", "market", "unrelated"]);

function validateT07Output(data, { allowedArticleIds, expectedSubjectRelation = null }) {
  const required = ["what_happened", "why_matters", "impacts", "risks", "watch", "claims", "subject_relation"];
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== required.length
    || required.some((field) => !Object.hasOwn(data, field))) throw invalid();
  if (!ALLOWED_SUBJECT.has(data.subject_relation)) throw invalid();
  if (expectedSubjectRelation && data.subject_relation !== expectedSubjectRelation) throw invalid();
  for (const field of ["what_happened", "why_matters"]) {
    validatePointList(data[field]);
  }
  for (const field of ["impacts", "risks", "watch"]) {
    if (!Array.isArray(data[field]) || data[field].length > 6) throw invalid();
    data[field].forEach((item) => validateCitedItem(item, allowedArticleIds));
  }
  if (!Array.isArray(data.claims) || data.claims.length < 1 || data.claims.length > 12) throw invalid();
  const claimIds = new Set();
  data.claims.forEach((claim) => {
    if (!claim || typeof claim !== "object" || Array.isArray(claim) || Object.keys(claim).length !== 3
      || typeof claim.claim_id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(claim.claim_id) || claimIds.has(claim.claim_id)) throw invalid();
    claimIds.add(claim.claim_id);
    validateCitedItem(claim, allowedArticleIds);
  });
  return normalize(data);
}

function validatePointList(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) throw invalid();
  value.forEach((point) => {
    if (typeof point !== "string" || !point.trim() || point.trim().length > 280) throw invalid();
  });
}

function validateCitedItem(item, allowedArticleIds) {
  if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.text !== "string"
    || !item.text.trim() || item.text.trim().length > 500 || !Array.isArray(item.source_article_ids)
    || item.source_article_ids.length < 1 || item.source_article_ids.length > 5
    || new Set(item.source_article_ids).size !== item.source_article_ids.length
    || item.source_article_ids.some((id) => typeof id !== "string" || !allowedArticleIds.has(id))) throw invalid();
}

function normalize(data) {
  const trimItem = (item) => ({ ...item, text: item.text.trim(), source_article_ids: [...item.source_article_ids] });
  return {
    what_happened: data.what_happened.map((point) => point.trim()),
    why_matters: data.why_matters.map((point) => point.trim()),
    impacts: data.impacts.map(trimItem), risks: data.risks.map(trimItem), watch: data.watch.map(trimItem),
    claims: data.claims.map((claim) => ({ ...trimItem(claim), claim_id: claim.claim_id })),
    subject_relation: data.subject_relation,
  };
}

function invalid() { return new AiOutputError("T07 output has an invalid analysis shape or out-of-evidence citation", { code: "AI_OUTPUT_SCHEMA_INVALID" }); }

module.exports = { validateT07Output };
