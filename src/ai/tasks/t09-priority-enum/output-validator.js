const { AiOutputError } = require("../../provider/provider.errors");

const PRIORITIES = new Set(["tinggi", "sedang", "rendah"]);

function validateT09Output(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).length !== 1 || !PRIORITIES.has(data.priority)) {
    throw new AiOutputError("T09 must return only one priority enum: tinggi, sedang, or rendah", { code: "AI_OUTPUT_SCHEMA_INVALID" });
  }
  return { priority: data.priority };
}

module.exports = { PRIORITIES, validateT09Output };
