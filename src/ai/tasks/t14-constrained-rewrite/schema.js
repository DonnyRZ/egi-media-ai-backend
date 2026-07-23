const T14_OUTPUT_SCHEMA = Object.freeze({
  name: "constrained_rewrite_v1",
  schema: { type: "object", additionalProperties: false, required: ["replacement_text"], properties: { replacement_text: { type: "string", minLength: 1, maxLength: 1200 } } },
});
module.exports = { T14_OUTPUT_SCHEMA };
