const T05_OUTPUT_SCHEMA = Object.freeze({
  name: "issue_title_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: { title: { type: "string", minLength: 3, maxLength: 160 } },
  },
});

module.exports = { T05_OUTPUT_SCHEMA };
