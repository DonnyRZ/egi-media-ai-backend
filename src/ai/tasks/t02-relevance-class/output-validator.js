const { AiOutputError } = require("../../provider/provider.errors");

const ALLOWED_RELEVANCE = new Set(["high", "medium", "low", "none"]);
const ALLOWED_SUBJECT = new Set(["self", "competitor", "market", "unrelated"]);

function validateT02Output(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || !Object.hasOwn(data, "relevance") || !Object.hasOwn(data, "confidence")
    || !Object.hasOwn(data, "subject_relation")) {
    throw new AiOutputError("T02 output must contain relevance, confidence, and subject_relation", { code: "AI_OUTPUT_SCHEMA_INVALID" });
  }
  const keys = Object.keys(data);
  if (keys.length !== 3) {
    throw new AiOutputError("T02 output must contain only relevance, confidence, and subject_relation", { code: "AI_OUTPUT_SCHEMA_INVALID" });
  }
  if (!ALLOWED_RELEVANCE.has(data.relevance) || typeof data.confidence !== "number"
    || !Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) {
    throw new AiOutputError("T02 output has invalid relevance or confidence", { code: "AI_OUTPUT_SCHEMA_INVALID" });
  }
  if (!ALLOWED_SUBJECT.has(data.subject_relation)) {
    throw new AiOutputError("T02 output has invalid subject_relation", { code: "AI_OUTPUT_SCHEMA_INVALID" });
  }
  return data;
}

module.exports = { validateT02Output };
