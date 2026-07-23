const citedItem = {
  type: "object", additionalProperties: false, required: ["text", "source_article_ids"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 500 },
    source_article_ids: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", format: "uuid" } },
  },
};

const T07_OUTPUT_SCHEMA = Object.freeze({
  name: "issue_analysis_v1",
  schema: {
    type: "object", additionalProperties: false,
    required: ["what_happened", "why_matters", "impacts", "risks", "watch", "claims"],
    properties: {
      what_happened: { type: "string", minLength: 1, maxLength: 1200 },
      why_matters: { type: "string", minLength: 1, maxLength: 1200 },
      impacts: { type: "array", maxItems: 6, items: citedItem },
      risks: { type: "array", maxItems: 6, items: citedItem },
      watch: { type: "array", maxItems: 6, items: citedItem },
      claims: {
        type: "array", minItems: 1, maxItems: 12,
        items: {
          type: "object", additionalProperties: false, required: ["claim_id", "text", "source_article_ids"],
          properties: { claim_id: { type: "string", minLength: 1, maxLength: 64 }, ...citedItem.properties },
        },
      },
    },
  },
});

module.exports = { T07_OUTPUT_SCHEMA };
