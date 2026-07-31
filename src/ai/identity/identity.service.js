"use strict";

const {
  MANAGEMENT_IDENTITY_PROMPT_ID,
  MANAGEMENT_IDENTITY_PROMPT_VERSION,
  MANAGEMENT_IDENTITY_OUTPUT_SCHEMA,
} = require("./schema");
const { buildManagementIdentityDraftInput } = require("./prompt");
const {
  validateManagementIdentityOutput,
  fingerprintManagementIdentity,
} = require("./management-identity");

/**
 * Drafts and persists management identity for an activated company context.
 */
class ManagementIdentityService {
  constructor({
    promptExecutionService,
    identityStore,
    timeoutMs = 120000,
  }) {
    if (!promptExecutionService?.executeActive) {
      throw new Error("ManagementIdentityService requires promptExecutionService");
    }
    if (!identityStore?.upsert || !identityStore?.get) {
      throw new Error("ManagementIdentityService requires identityStore");
    }
    this.promptExecutionService = promptExecutionService;
    this.identityStore = identityStore;
    this.timeoutMs = timeoutMs;
  }

  async get({ tenantId = null, companyId, contextVersion }) {
    return this.identityStore.get({ tenantId, companyId, contextVersion });
  }

  /**
   * Sync generate + persist. On failure, stores status=failed but does not throw
   * unless throwOnError is true (so context activate can still succeed).
   */
  async draftAndPersist({
    tenantId = null,
    companyId,
    contextVersion,
    fields,
    throwOnError = false,
  }) {
    await this.identityStore.upsert({
      tenantId,
      companyId,
      contextVersion,
      status: "pending",
      identity: null,
      provenance: null,
      errorMessage: null,
    });

    try {
      const result = await this.promptExecutionService.executeActive({
        promptId: MANAGEMENT_IDENTITY_PROMPT_ID,
        promptVersion: MANAGEMENT_IDENTITY_PROMPT_VERSION,
        model: "mini",
        timeoutMs: this.timeoutMs,
        input: buildManagementIdentityDraftInput({ companyId, contextVersion, fields }),
        outputSchema: MANAGEMENT_IDENTITY_OUTPUT_SCHEMA,
        validateResult: (data) => validateManagementIdentityOutput(data, { fields }),
        budgetScope: { tenantId, companyId },
      });

      const draft = validateManagementIdentityOutput(result.data, { fields });
      const identity = {
        ...draft,
        fingerprint: fingerprintManagementIdentity(draft),
      };
      const provenance = {
        model: result.provenance?.model || null,
        promptId: MANAGEMENT_IDENTITY_PROMPT_ID,
        promptVersion: MANAGEMENT_IDENTITY_PROMPT_VERSION,
        providerRequestId: result.provenance?.providerRequestId || result.provenance?.requestId || null,
        contextVersion,
      };

      return this.identityStore.upsert({
        tenantId,
        companyId,
        contextVersion,
        status: "ready",
        identity,
        provenance,
        errorMessage: null,
      });
    } catch (error) {
      const failed = await this.identityStore.upsert({
        tenantId,
        companyId,
        contextVersion,
        status: "failed",
        identity: null,
        provenance: null,
        errorMessage: error?.message || String(error),
      });
      if (throwOnError) throw error;
      return failed;
    }
  }
}

/**
 * Stamp for TRUSTED_CONTEXT: persona fields only (no provenance dump).
 */
function trustedManagementIdentity(record) {
  if (!record || record.status !== "ready" || !record.identity) return null;
  return {
    version: record.identity.version,
    company_name: record.identity.company_name,
    identity: record.identity.identity,
    lens_summary: record.identity.lens_summary,
    fingerprint: record.identity.fingerprint || null,
  };
}

module.exports = {
  ManagementIdentityService,
  trustedManagementIdentity,
};
