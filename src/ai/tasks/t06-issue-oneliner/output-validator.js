const { AiOutputError } = require("../../provider/provider.errors");

function validateT06Output(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).length !== 1 || !Object.hasOwn(data, "one_liner") || typeof data.one_liner !== "string") throw invalid();
  const oneLiner = data.one_liner.trim();
  if (oneLiner.length < 8 || oneLiner.length > 280 || /[\r\n]/.test(oneLiner) || /https?:\/\//i.test(oneLiner)) throw invalid();
  return { oneLiner };
}

function invalid() {
  return new AiOutputError("T06 output must contain one bounded single-line one-liner without a URL", { code: "AI_OUTPUT_SCHEMA_INVALID" });
}

module.exports = { validateT06Output };
