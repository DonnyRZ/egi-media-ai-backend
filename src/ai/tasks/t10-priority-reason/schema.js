const T10_OUTPUT_SCHEMA = Object.freeze({
  name: "priority_reason_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reason", "source_claim_ids"],
    properties: {
      reason: { type: "string", minLength: 1, maxLength: 500 },
      source_claim_ids: {
        type: "array", minItems: 1, maxItems: 6,
        items: { type: "string", minLength: 1, maxLength: 64 },
      },
    },
  },
});

module.exports = { T10_OUTPUT_SCHEMA };
