// Accepts legacy bare CMS UUIDs and F4 crawl ids (`crawl:<source_id>:<content_hash>`).
// Do not use format:uuid — OpenAI strict json_schema would reject crawl citations.
const ISSUE_SOURCE_ARTICLE_ID = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 160,
});

const pointText = Object.freeze({ type: "string", minLength: 1, maxLength: 280 });

const citedItem = {
  type: "object", additionalProperties: false, required: ["text", "source_article_ids"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 500 },
    source_article_ids: { type: "array", minItems: 1, maxItems: 5, items: ISSUE_SOURCE_ARTICLE_ID },
  },
};

const T07_OUTPUT_SCHEMA = Object.freeze({
  name: "issue_analysis_v2",
  schema: {
    type: "object", additionalProperties: false,
    required: ["what_happened", "why_matters", "impacts", "risks", "watch", "claims"],
    properties: {
      // Discrete points (not paragraphs) for the issue drawer and downstream packers.
      what_happened: { type: "array", minItems: 1, maxItems: 6, items: pointText },
      why_matters: { type: "array", minItems: 1, maxItems: 6, items: pointText },
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

module.exports = { ISSUE_SOURCE_ARTICLE_ID, T07_OUTPUT_SCHEMA };
