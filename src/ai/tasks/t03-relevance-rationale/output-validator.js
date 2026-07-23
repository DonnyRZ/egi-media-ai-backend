const { AiOutputError } = require("../../provider/provider.errors");

function validateT03Output(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).length !== 1 || !Object.hasOwn(data, "rationale")
    || typeof data.rationale !== "string") {
    throw new AiOutputError("T03 output must contain only rationale", { code: "AI_OUTPUT_SCHEMA_INVALID" });
  }

  const rationale = data.rationale.trim();
  if (!rationale || rationale.length > 500) {
    throw new AiOutputError("T03 rationale must be a non-empty short string", { code: "AI_OUTPUT_SCHEMA_INVALID" });
  }
  return { rationale };
}

module.exports = { validateT03Output };
