const T04_OUTPUT_SCHEMA = Object.freeze({
  name: "issue_match_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["decision", "candidate_issue_id", "reason_code"],
    properties: {
      decision: { type: "string", enum: ["new", "update"] },
      candidate_issue_id: { type: ["string", "null"], format: "uuid" },
      reason_code: { type: "string", enum: ["same_event", "new_event", "insufficient_data"] },
    },
  },
});

module.exports = { T04_OUTPUT_SCHEMA };
