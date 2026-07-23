const T12_OUTPUT_SCHEMA = Object.freeze({
  name: "direct_alert_blurbs_v1",
  schema: {
    type: "object", additionalProperties: false,
    required: ["new_development_blurb", "short_impact_blurb", "source_claim_ids"],
    properties: {
      new_development_blurb: { type: "string", minLength: 1, maxLength: 320 },
      short_impact_blurb: { type: "string", minLength: 1, maxLength: 320 },
      source_claim_ids: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 64 } },
    },
  },
});

module.exports = { T12_OUTPUT_SCHEMA };
