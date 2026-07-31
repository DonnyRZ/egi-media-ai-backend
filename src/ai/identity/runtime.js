"use strict";

const { PromptRegistry } = require("../prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../provenance/prompt-run.store");
const { createManagementIdentityPromptDefinition } = require("./schema");
const { InMemoryManagementIdentityStore } = require("./identity.store");
const { ManagementIdentityService, trustedManagementIdentity } = require("./identity.service");

function createManagementIdentityRuntime({
  aiTaskKernel,
  openaiConfig,
  identityStore = null,
  promptRegistry = null,
  runStore = null,
} = {}) {
  const modelName = openaiConfig.miniModel || openaiConfig.model;
  const registry = promptRegistry || new PromptRegistry([
    createManagementIdentityPromptDefinition({ modelName }),
  ]);
  const provenanceStore = runStore || new InMemoryPromptRunStore();
  const store = identityStore || new InMemoryManagementIdentityStore();
  const promptExecutionService = new PromptExecutionService({
    promptRegistry: registry,
    aiTaskKernel,
    runStore: provenanceStore,
    openaiConfig,
  });

  return {
    service: new ManagementIdentityService({
      promptExecutionService,
      identityStore: store,
      timeoutMs: openaiConfig.t01TimeoutMs || openaiConfig.timeoutMs || 120000,
    }),
    identityStore: store,
    promptRegistry: registry,
    runStore: provenanceStore,
  };
}

/**
 * Load effective company context and attach trusted management_identity when ready.
 */
async function getEffectiveFullContext({
  getEffectiveContext,
  identityStore,
  companyId,
  tenantId = null,
}) {
  const context = await getEffectiveContext(companyId, tenantId);
  if (!context) return null;
  return attachTrustedIdentity({ context, identityStore, companyId, tenantId });
}

/**
 * Load a specific context version (effective or archived) + trusted identity.
 */
async function getFullContextByVersion({
  getContextVersion,
  identityStore,
  companyId,
  contextVersion,
  tenantId = null,
}) {
  const context = await getContextVersion(companyId, contextVersion, tenantId);
  if (!context) return null;
  return attachTrustedIdentity({ context, identityStore, companyId, tenantId });
}

async function attachTrustedIdentity({ context, identityStore, companyId, tenantId = null }) {
  const record = identityStore
    ? await identityStore.get({
      tenantId: tenantId ?? context.tenantId ?? null,
      companyId,
      contextVersion: context.version,
    })
    : null;
  return {
    ...context,
    managementIdentity: trustedManagementIdentity(record),
  };
}

module.exports = {
  createManagementIdentityRuntime,
  getEffectiveFullContext,
  getFullContextByVersion,
  trustedManagementIdentity,
};
