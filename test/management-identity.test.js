"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MANAGEMENT_IDENTITY_VERSION,
  SYSTEM_POLICY,
  buildManagementIdentityDraftInput,
  validateManagementIdentityOutput,
  fingerprintManagementIdentity,
  applyManagementIdentity,
} = require("../src/ai/identity");

test("system policy centers leadership persona not company brochure", () => {
  assert.match(SYSTEM_POLICY, /leadership-team persona|leadership persona/i);
  assert.match(SYSTEM_POLICY, /strategic mandate|leadership role/i);
  assert.match(SYSTEM_POLICY, /do not duplicate|separately to later tasks/i);
  assert.match(SYSTEM_POLICY, /you \/ your|Do not use we/i);
  assert.doesNotMatch(SYSTEM_POLICY, /hotel|hospitality|EGI Media|observer|care about|ignore/i);
});

test("draft input separates identity persona from company context scope", () => {
  const input = buildManagementIdentityDraftInput({
    companyId: "c1",
    contextVersion: 2,
    fields: {
      name: "Example Company",
      industry: "Industrial software",
      products: ["Platform A", "Platform B"],
    },
  });
  assert.equal(input[0].role, "system");
  assert.equal(input[1].role, "user");
  assert.match(input[1].content, /Example Company/);
  assert.match(input[1].content, /company_context_fields/);
  assert.match(input[1].content, /division_of_labor/);
  assert.match(input[1].content, /Do not enumerate products/i);
  assert.match(input[1].content, /Never use we \/ our \/ us/i);
  assert.match(input[1].content, /You are the management/);
});

test("validateManagementIdentityOutput accepts grounded draft", () => {
  const draft = validateManagementIdentityOutput({
    version: MANAGEMENT_IDENTITY_VERSION,
    company_name: "Example Company",
    identity: "You are the management / leadership of Example Company. You focus on strategic decisions for this company's position, risks, and growth.",
    lens_summary: "Leadership of Example Company focused on strategic stewardship.",
  }, {
    fields: { name: "Example Company" },
  });
  assert.equal(draft.company_name, "Example Company");
  assert.equal(fingerprintManagementIdentity(draft).length, 16);
});

test("validateManagementIdentityOutput rejects company_name that ignores context name", () => {
  assert.throws(() => validateManagementIdentityOutput({
    version: MANAGEMENT_IDENTITY_VERSION,
    company_name: "Totally Different Corp",
    identity: "Saya adalah manajemen Totally Different Corp dengan bisnis yang panjang cukup untuk lolos validasi panjang minimum.",
    lens_summary: "Perusahaan fiktif yang tidak cocok.",
  }, {
    fields: { name: "Example Company" },
  }), /company_name/);
});

test("applyManagementIdentity stamps Luna draft onto TRUSTED_CONTEXT", () => {
  const stamped = applyManagementIdentity(
    { company_id: "c1" },
    {
      version: MANAGEMENT_IDENTITY_VERSION,
      company_name: "Example Company",
      identity: "You are the management of Example Company. You focus on strategic decisions for this company.",
      lens_summary: "Leadership of Example Company — strategic stewardship.",
    },
  );
  assert.equal(stamped.company_id, "c1");
  assert.equal(stamped.management_identity.company_name, "Example Company");
  assert.match(stamped.management_identity.identity, /Example Company/);
  assert.equal(typeof stamped.management_identity.fingerprint, "string");
});
