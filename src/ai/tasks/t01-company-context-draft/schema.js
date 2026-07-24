const CONTEXT_FIELDS = Object.freeze([
  "name",
  "industry",
  "sub_industry",
  "description",
  "products",
  "customers",
  "regions",
  "competitors",
  "priorities",
  "goals",
  "risks",
  "topics",
  "dependencies",
]);

const SCALAR_FIELDS = Object.freeze(["name", "industry", "sub_industry", "description"]);
const ARRAY_FIELDS = Object.freeze(CONTEXT_FIELDS.filter((field) => !SCALAR_FIELDS.includes(field)));

function createT01OutputSchema(sourceLocators) {
  return {
    name: "company_context_draft_v1",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["status", "context", "field_sources", "missing_fields"],
      properties: {
        status: { type: "string", enum: ["complete", "insufficient_data"] },
        context: createContextSchema(),
        field_sources: {
          type: "array",
          maxItems: CONTEXT_FIELDS.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["field", "source_locator"],
            properties: {
              field: { type: "string", enum: CONTEXT_FIELDS },
              source_locator: { type: "string", enum: sourceLocators },
            },
          },
        },
        missing_fields: {
          type: "array",
          maxItems: CONTEXT_FIELDS.length,
          items: { type: "string", enum: CONTEXT_FIELDS },
        },
      },
    },
  };
}

function createContextSchema() {
  const properties = {};
  for (const field of SCALAR_FIELDS) {
    properties[field] = { anyOf: [{ type: "string", maxLength: field === "description" ? 2000 : 200 }, { type: "null" }] };
  }
  for (const field of ARRAY_FIELDS) {
    properties[field] = {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 200 },
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    required: CONTEXT_FIELDS,
    properties,
  };
}

module.exports = { CONTEXT_FIELDS, SCALAR_FIELDS, ARRAY_FIELDS, createT01OutputSchema };
