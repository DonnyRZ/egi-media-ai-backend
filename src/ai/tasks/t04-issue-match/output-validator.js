const { AiOutputError } = require("../../provider/provider.errors");

const REASON_CODES = new Set(["same_event", "new_event", "insufficient_data"]);

function validateT04Output(data, { candidateIssueIds }) {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).length !== 3
    || !Object.hasOwn(data, "decision") || !Object.hasOwn(data, "candidate_issue_id") || !Object.hasOwn(data, "reason_code")) {
    throw invalid();
  }
  if (!["new", "update"].includes(data.decision) || !REASON_CODES.has(data.reason_code)) throw invalid();

  if (data.decision === "new") {
    if (data.candidate_issue_id !== null || !["new_event", "insufficient_data"].includes(data.reason_code)) throw invalid();
    return data;
  }

  if (typeof data.candidate_issue_id !== "string" || !candidateIssueIds.has(data.candidate_issue_id)
    || data.reason_code !== "same_event") throw invalid();
  return data;
}

function invalid() {
  return new AiOutputError("T04 output is not a valid new/update decision for the candidate set", { code: "AI_OUTPUT_SCHEMA_INVALID" });
}

module.exports = { validateT04Output };
