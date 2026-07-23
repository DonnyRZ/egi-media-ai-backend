const { AiOutputError } = require("../../provider/provider.errors");
const { CONTEXT_FIELDS, SCALAR_FIELDS } = require("./schema");

function validateT01Output(data, { sourceLocators }) {
  const allowedLocators = new Set(sourceLocators);
  const sourceByField = new Map();

  for (const item of data.field_sources) {
    if (!allowedLocators.has(item.source_locator)) {
      throw new AiOutputError("T01 output cited a source locator outside the input set", {
        code: "AI_OUTPUT_SOURCE_LOCATOR_INVALID",
      });
    }
    if (sourceByField.has(item.field)) {
      throw new AiOutputError("T01 output supplied duplicate field sources", {
        code: "AI_OUTPUT_SOURCE_LOCATOR_INVALID",
      });
    }
    sourceByField.set(item.field, item.source_locator);
  }

  const missingFields = new Set(data.missing_fields);
  for (const field of CONTEXT_FIELDS) {
    const hasValue = hasContextValue(data.context[field], field);
    if (hasValue && !sourceByField.has(field)) {
      throw new AiOutputError("T01 populated a field without an allowed source locator", {
        code: "AI_OUTPUT_SOURCE_LOCATOR_INVALID",
        details: { field },
      });
    }
    if (!hasValue && !missingFields.has(field)) {
      throw new AiOutputError("T01 omitted an unsupported field from missing_fields", {
        code: "AI_OUTPUT_CONTEXT_INCOMPLETE",
        details: { field },
      });
    }
    if (!hasValue && sourceByField.has(field)) {
      throw new AiOutputError("T01 cited a field with no extracted value", {
        code: "AI_OUTPUT_SOURCE_LOCATOR_INVALID",
        details: { field },
      });
    }
  }

  assertNoInternalInstructionMarkers(data.context);

  return data;
}

function hasContextValue(value, field) {
  return SCALAR_FIELDS.includes(field) ? value !== null && value.trim().length > 0 : value.length > 0;
}

function assertNoInternalInstructionMarkers(context) {
  const forbiddenMarker = /<\/?(?:SYSTEM_POLICY|TASK_CONTRACT|TRUSTED_CONTEXT|UNTRUSTED_SOURCE_DATA|OUTPUT_SCHEMA|OUTPUT_REQUIREMENT)>/i;
  for (const value of Object.values(context)) {
    const texts = Array.isArray(value) ? value : [value];
    for (const text of texts) {
      if (typeof text === "string" && forbiddenMarker.test(text)) {
        throw new AiOutputError("T01 output contains an internal prompt delimiter", {
          code: "AI_OUTPUT_SAFETY_INVALID",
        });
      }
    }
  }
}

module.exports = { validateT01Output };
