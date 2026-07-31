"use strict";

const { createHash } = require("crypto");
const { AiOutputError } = require("../provider/provider.errors");
const { MANAGEMENT_IDENTITY_VERSION } = require("./schema");

function asNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validate Luna identity draft beyond JSON Schema (semantic checks).
 */
function validateManagementIdentityOutput(data, { fields } = {}) {
  if (!data || typeof data !== "object") {
    throw new AiOutputError("Management identity output must be an object", {
      code: "AI_OUTPUT_INVALID",
    });
  }
  if (data.version !== MANAGEMENT_IDENTITY_VERSION) {
    throw new AiOutputError("Management identity version mismatch", {
      code: "AI_OUTPUT_INVALID",
      details: { expected: MANAGEMENT_IDENTITY_VERSION, actual: data.version },
    });
  }

  const identity = asNonEmptyString(data.identity);
  const companyName = asNonEmptyString(data.company_name);
  const lens = asNonEmptyString(data.lens_summary);
  if (!identity || !companyName || !lens) {
    throw new AiOutputError("Management identity fields must be non-empty strings", {
      code: "AI_OUTPUT_INVALID",
    });
  }

  const contextName = asNonEmptyString(fields?.name);
  if (contextName) {
    const expected = contextName.toLowerCase();
    const actual = companyName.toLowerCase();
    // Allow exact or containment either way (legal name vs short name).
    if (!actual.includes(expected) && !expected.includes(actual)) {
      throw new AiOutputError("Management identity company_name must reflect context name", {
        code: "AI_OUTPUT_INVALID",
        details: { expected: contextName, actual: companyName },
      });
    }
  }

  return {
    version: MANAGEMENT_IDENTITY_VERSION,
    company_name: companyName,
    identity,
    lens_summary: lens,
  };
}

function fingerprintManagementIdentity(draft) {
  return createHash("sha256")
    .update(JSON.stringify({
      version: draft.version,
      company_name: draft.company_name,
      identity: draft.identity,
      lens_summary: draft.lens_summary,
    }))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Stamp a validated Luna identity onto TRUSTED_CONTEXT.
 */
function applyManagementIdentity(trustedContext, draft) {
  const validated = validateManagementIdentityOutput(draft);
  return {
    ...trustedContext,
    management_identity: {
      version: validated.version,
      company_name: validated.company_name,
      identity: validated.identity,
      lens_summary: validated.lens_summary,
      fingerprint: fingerprintManagementIdentity(validated),
    },
  };
}

module.exports = {
  validateManagementIdentityOutput,
  fingerprintManagementIdentity,
  applyManagementIdentity,
};
