"use strict";

const {
  MANAGEMENT_IDENTITY_VERSION,
  MANAGEMENT_IDENTITY_PROMPT_ID,
  MANAGEMENT_IDENTITY_PROMPT_VERSION,
  MANAGEMENT_IDENTITY_OUTPUT_SCHEMA,
  createManagementIdentityPromptDefinition,
} = require("./schema");
const { SYSTEM_POLICY, buildManagementIdentityDraftInput } = require("./prompt");
const {
  validateManagementIdentityOutput,
  fingerprintManagementIdentity,
  applyManagementIdentity,
} = require("./management-identity");
const { InMemoryManagementIdentityStore } = require("./identity.store");
const { ManagementIdentityService, trustedManagementIdentity } = require("./identity.service");
const {
  createManagementIdentityRuntime,
  getEffectiveFullContext,
  getFullContextByVersion,
} = require("./runtime");
const {
  trustedIdentityStamp,
  leadershipSystemPreamble,
  withManagementIdentity,
  REGISTRY_BOOTSTRAP_CONTEXT,
} = require("./prompt-stamp");
const { checkManagementIdentityQuality } = require("./quality-checks");
const {
  resolveManagementIdentityReadiness,
  assertManagementIdentityReady,
  managementIdentityRequiredError,
  serializeManagementIdentitySummary,
} = require("./readiness");

module.exports = {
  MANAGEMENT_IDENTITY_VERSION,
  MANAGEMENT_IDENTITY_PROMPT_ID,
  MANAGEMENT_IDENTITY_PROMPT_VERSION,
  MANAGEMENT_IDENTITY_OUTPUT_SCHEMA,
  createManagementIdentityPromptDefinition,
  SYSTEM_POLICY,
  buildManagementIdentityDraftInput,
  validateManagementIdentityOutput,
  fingerprintManagementIdentity,
  applyManagementIdentity,
  InMemoryManagementIdentityStore,
  ManagementIdentityService,
  trustedManagementIdentity,
  createManagementIdentityRuntime,
  getEffectiveFullContext,
  getFullContextByVersion,
  trustedIdentityStamp,
  leadershipSystemPreamble,
  withManagementIdentity,
  REGISTRY_BOOTSTRAP_CONTEXT,
  checkManagementIdentityQuality,
  resolveManagementIdentityReadiness,
  assertManagementIdentityReady,
  managementIdentityRequiredError,
  serializeManagementIdentitySummary,
};
