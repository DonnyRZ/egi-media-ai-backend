const T02_OUTPUT_SCHEMA = Object.freeze({
  name: "relevance_class_v2",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["relevance", "confidence", "subject_relation"],
    properties: {
      relevance: { type: "string", enum: ["high", "medium", "low", "none"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      subject_relation: {
        type: "string",
        enum: ["self", "competitor", "market", "unrelated"],
      },
    },
  },
});

module.exports = { T02_OUTPUT_SCHEMA };
