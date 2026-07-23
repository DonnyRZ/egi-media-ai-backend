const { AiOutputError } = require("../../provider/provider.errors");

function validateT05Output(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).length !== 1 || !Object.hasOwn(data, "title") || typeof data.title !== "string") {
    throw invalid();
  }
  const title = data.title.trim();
  if (title.length < 3 || title.length > 160 || /[\r\n]/.test(title) || /https?:\/\//i.test(title)) throw invalid();
  return { title };
}

function invalid() {
  return new AiOutputError("T05 output must contain one bounded single-line title without a URL", { code: "AI_OUTPUT_SCHEMA_INVALID" });
}

module.exports = { validateT05Output };
