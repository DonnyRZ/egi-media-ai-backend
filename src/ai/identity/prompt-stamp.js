"use strict";

/**
 * Shared FULL CONTEXT stamp helpers for judgmental AI tasks.
 */

/** Used only for static prompt-registry SYSTEM_POLICY module exports. Runtime calls must pass a ready identity. */
const REGISTRY_BOOTSTRAP_CONTEXT = Object.freeze({
  managementIdentity: Object.freeze({
    identity: "You act as the management / leadership of the company described in the supplied company context fields.",
    company_name: null,
    lens_summary: null,
    fingerprint: null,
  }),
});

function trustedIdentityStamp(context) {
  const mi = context?.managementIdentity;
  if (!mi?.identity) return null;
  return {
    version: mi.version || null,
    company_name: mi.company_name || null,
    identity: mi.identity,
    lens_summary: mi.lens_summary || null,
    fingerprint: mi.fingerprint || null,
  };
}

/**
 * System preamble: leadership persona required at runtime.
 * Does not restate company scope (that lives in company_context_fields).
 */
function leadershipSystemPreamble(context) {
  const stamp = trustedIdentityStamp(context);
  if (!stamp?.identity) {
    const error = new Error("Management identity ready is required for judgmental AI tasks");
    error.code = "MANAGEMENT_IDENTITY_REQUIRED";
    throw error;
  }
  return [
    stamp.identity,
    "Use company_context_fields as the factual scope of your company.",
    "management_identity is your persona; company_context_fields are your facts — use both.",
  ].join(" ");
}

function withManagementIdentity(trustedContext, context) {
  const stamp = trustedIdentityStamp(context);
  if (!stamp) return trustedContext;
  return { ...trustedContext, management_identity: stamp };
}

module.exports = {
  REGISTRY_BOOTSTRAP_CONTEXT,
  trustedIdentityStamp,
  leadershipSystemPreamble,
  withManagementIdentity,
};
