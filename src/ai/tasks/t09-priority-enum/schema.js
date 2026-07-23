const T09_OUTPUT_SCHEMA = Object.freeze({
  name: "priority_enum_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["priority"],
    properties: {
      priority: { type: "string", enum: ["tinggi", "sedang", "rendah"] },
    },
  },
});

module.exports = { T09_OUTPUT_SCHEMA };
