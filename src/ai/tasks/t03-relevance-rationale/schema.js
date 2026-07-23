const T03_OUTPUT_SCHEMA = Object.freeze({
  name: "relevance_rationale_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["rationale"],
    properties: {
      rationale: { type: "string", minLength: 1, maxLength: 500 },
    },
  },
});

module.exports = { T03_OUTPUT_SCHEMA };
