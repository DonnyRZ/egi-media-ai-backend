"use strict";

const MANAGEMENT_IDENTITY_VERSION = "1.0.0";
const MANAGEMENT_IDENTITY_PROMPT_ID = "management_identity_draft";
const MANAGEMENT_IDENTITY_PROMPT_VERSION = "1.0.3";

const MANAGEMENT_IDENTITY_OUTPUT_SCHEMA = Object.freeze({
  name: "management_identity_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["version", "company_name", "identity", "lens_summary"],
    properties: {
      version: { type: "string", enum: [MANAGEMENT_IDENTITY_VERSION] },
      company_name: { type: "string", minLength: 1, maxLength: 200 },
      identity: { type: "string", minLength: 40, maxLength: 2000 },
      lens_summary: { type: "string", minLength: 8, maxLength: 300 },
    },
  },
});

function createManagementIdentityPromptDefinition({ modelName }) {
  return {
    promptId: MANAGEMENT_IDENTITY_PROMPT_ID,
    version: MANAGEMENT_IDENTITY_PROMPT_VERSION,
    status: "active",
    owner: "ai-engineering",
    modelCompatibility: [modelName],
    inputSchemaVersion: "1.0",
    outputSchemaVersion: "1.0",
    changeSummary: "Lock singular you-voice for leadership persona; no we/our",
    approvedBy: null,
    rollbackVersion: null,
  };
}

module.exports = {
  MANAGEMENT_IDENTITY_VERSION,
  MANAGEMENT_IDENTITY_PROMPT_ID,
  MANAGEMENT_IDENTITY_PROMPT_VERSION,
  MANAGEMENT_IDENTITY_OUTPUT_SCHEMA,
  createManagementIdentityPromptDefinition,
};
