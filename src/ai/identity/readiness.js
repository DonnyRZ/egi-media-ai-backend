"use strict";

/**
 * Resolve whether a company may run AI intake / judgmental tasks.
 * Requires an effective company context and a ready management identity
 * for that context version.
 */

function managementIdentityRequiredError(details = {}) {
  return Object.assign(new Error("Management identity must be ready before news intake or judgmental AI tasks"), {
    code: "MANAGEMENT_IDENTITY_REQUIRED",
    statusCode: 409,
    details,
  });
}

/**
 * @returns {{
 *   ready: boolean,
 *   status: 'ready'|'failed'|'pending'|'missing',
 *   contextVersion: number|null,
 *   hasEffectiveContext: boolean,
 *   identity: object|null,
 *   record: object|null,
 * }}
 */
async function resolveManagementIdentityReadiness({
  effectiveContextStore,
  identityStore,
  companyId,
  tenantId = null,
}) {
  if (!effectiveContextStore?.getEffective) {
    throw new TypeError("resolveManagementIdentityReadiness requires effectiveContextStore");
  }

  const context = await effectiveContextStore.getEffective(companyId, tenantId);
  if (!context || context.status !== "effective") {
    return {
      ready: false,
      status: "missing",
      contextVersion: null,
      hasEffectiveContext: false,
      identity: null,
      record: null,
    };
  }

  const record = identityStore?.get
    ? await identityStore.get({
      tenantId: tenantId ?? context.tenantId ?? null,
      companyId,
      contextVersion: context.version,
    })
    : null;

  if (!record) {
    return {
      ready: false,
      status: "missing",
      contextVersion: context.version,
      hasEffectiveContext: true,
      identity: null,
      record: null,
    };
  }

  const status = record.status === "ready" || record.status === "failed" || record.status === "pending"
    ? record.status
    : "missing";

  return {
    ready: status === "ready" && Boolean(record.identity),
    status,
    contextVersion: context.version,
    hasEffectiveContext: true,
    identity: record.identity || null,
    record,
  };
}

async function assertManagementIdentityReady(args) {
  const readiness = await resolveManagementIdentityReadiness(args);
  if (!readiness.ready) {
    throw managementIdentityRequiredError({
      companyId: args.companyId,
      tenantId: args.tenantId ?? null,
      status: readiness.status,
      contextVersion: readiness.contextVersion,
      hasEffectiveContext: readiness.hasEffectiveContext,
    });
  }
  return readiness;
}

function serializeManagementIdentitySummary(record, { contextVersion = null } = {}) {
  if (!record) {
    return {
      status: "missing",
      context_version: contextVersion,
      company_name: null,
      lens_summary: null,
      fingerprint: null,
      error_message: null,
      updated_at: null,
    };
  }
  return {
    status: record.status || "missing",
    context_version: record.contextVersion ?? contextVersion,
    company_name: record.identity?.company_name || null,
    lens_summary: record.identity?.lens_summary || null,
    fingerprint: record.identity?.fingerprint || null,
    error_message: record.errorMessage || null,
    updated_at: record.updatedAt || null,
  };
}

module.exports = {
  resolveManagementIdentityReadiness,
  assertManagementIdentityReady,
  managementIdentityRequiredError,
  serializeManagementIdentitySummary,
};
