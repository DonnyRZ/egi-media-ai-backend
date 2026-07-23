const T06_OUTPUT_SCHEMA = Object.freeze({
  name: "issue_oneliner_v1",
  schema: {
    type: "object", additionalProperties: false, required: ["one_liner"],
    properties: { one_liner: { type: "string", minLength: 8, maxLength: 280 } },
  },
});

module.exports = { T06_OUTPUT_SCHEMA };
