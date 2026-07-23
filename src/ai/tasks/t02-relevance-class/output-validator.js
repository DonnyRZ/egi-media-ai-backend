const { AiOutputError } = require("../../provider/provider.errors");

const ALLOWED_RELEVANCE = new Set(["high", "medium", "low", "none"]);

function validateT02Output(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).length !== 2 || !Object.hasOwn(data, "relevance") || !Object.hasOwn(data, "confidence")) {
    throw new AiOutputError("T02 output must contain only relevance and confidence", { code: "AI_OUTPUT_SCHEMA_INVALID" });
  }
  if (!ALLOWED_RELEVANCE.has(data.relevance) || typeof data.confidence !== "number"
    || !Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) {
    throw new AiOutputError("T02 output has invalid relevance or confidence", { code: "AI_OUTPUT_SCHEMA_INVALID" });
  }
  return data;
}

module.exports = { validateT02Output };
