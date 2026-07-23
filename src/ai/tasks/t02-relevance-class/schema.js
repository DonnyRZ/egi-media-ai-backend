const T02_OUTPUT_SCHEMA = Object.freeze({
  name: "relevance_class_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["relevance", "confidence"],
    properties: {
      relevance: { type: "string", enum: ["high", "medium", "low", "none"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  },
});

module.exports = { T02_OUTPUT_SCHEMA };
