const CITED_TEXT = { type: "object", additionalProperties: false, required: ["narrative", "source_claim_ids"], properties: { narrative: { type: "string", minLength: 1, maxLength: 1200 }, source_claim_ids: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 64 } } } };
const T13_OUTPUT_SCHEMA = Object.freeze({
  name: "report_narrative_v1",
  schema: { type: "object", additionalProperties: false, required: ["executive_summary", "issue_narratives", "impact_narrative", "watch_items", "source_references"], properties: {
    executive_summary: { type: "string", minLength: 1, maxLength: 1600 },
    issue_narratives: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, required: ["report_item_id", "narrative", "source_claim_ids"], properties: { report_item_id: { type: "string", minLength: 1, maxLength: 64 }, ...CITED_TEXT.properties } } },
    impact_narrative: CITED_TEXT,
    watch_items: { type: "array", minItems: 1, maxItems: 12, items: CITED_TEXT },
    source_references: { type: "array", minItems: 1, maxItems: 60, items: { type: "object", additionalProperties: false, required: ["claim_id", "source_article_id"], properties: { claim_id: { type: "string", minLength: 1, maxLength: 64 }, source_article_id: { type: "string", minLength: 1, maxLength: 64 } } } },
  } },
});
module.exports = { T13_OUTPUT_SCHEMA };
