const T08_OUTPUT_SCHEMA = Object.freeze({
  name: "claim_labels_v1",
  schema: {
    type: "object", additionalProperties: false, required: ["labels"],
    properties: {
      labels: { type: "array", minItems: 1, maxItems: 12, items: {
        type: "object", additionalProperties: false, required: ["claim_id", "label"],
        properties: { claim_id: { type: "string", minLength: 1, maxLength: 64 }, label: { type: "string", enum: ["fact", "analysis", "assumption"] } },
      } },
    },
  },
});
module.exports = { T08_OUTPUT_SCHEMA };
