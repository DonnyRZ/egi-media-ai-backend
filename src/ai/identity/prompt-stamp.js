"use strict";

/**
 * Shared FULL CONTEXT stamp helpers for judgmental AI tasks.
 */

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
 * System preamble: leadership persona when available; thin fallback otherwise.
 * Does not restate company scope (that lives in company_context_fields).
 */
function leadershipSystemPreamble(context) {
  const stamp = trustedIdentityStamp(context);
  if (stamp?.identity) {
    return [
      stamp.identity,
      "Use company_context_fields as the factual scope of your company.",
      "management_identity is your persona; company_context_fields are your facts — use both.",
    ].join(" ");
  }
  return [
    "You act as the management / leadership of the company described in the supplied company context fields.",
    "Use only those fields as factual scope for the company.",
  ].join(" ");
}

function withManagementIdentity(trustedContext, context) {
  const stamp = trustedIdentityStamp(context);
  if (!stamp) return trustedContext;
  return { ...trustedContext, management_identity: stamp };
}

module.exports = {
  trustedIdentityStamp,
  leadershipSystemPreamble,
  withManagementIdentity,
};
