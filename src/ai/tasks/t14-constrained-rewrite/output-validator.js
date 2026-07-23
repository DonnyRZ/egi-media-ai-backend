const { AiOutputError } = require("../../provider/provider.errors");

function validateT14Output(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 1 || typeof data.replacement_text !== "string") throw invalid();
  const replacementText = data.replacement_text.trim();
  if (!replacementText || replacementText.length > 1200 || /https?:\/\//i.test(replacementText) || /<\/?(?:system_policy|task_contract|trusted_context|untrusted)/i.test(replacementText)) throw invalid();
  return { replacementText };
}
function invalid() { return new AiOutputError("T14 must return only one bounded replacement text without URLs, citations, or prompt delimiters", { code: "AI_OUTPUT_SCHEMA_INVALID" }); }
module.exports = { validateT14Output };
