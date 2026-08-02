"use strict";

function readyManagementIdentity(companyName = "Example Company") {
  const safeName = String(companyName || "Example Company");
  return {
    version: 1,
    status: "ready",
    identity: `You are the management and leadership of ${safeName}. Focus on material strategic decisions, risks, and opportunities for this company.`,
    company_name: safeName,
    lens_summary: "Material strategic decisions, risks, and opportunities for the company.",
    fingerprint: `test-identity-${safeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  };
}

module.exports = { readyManagementIdentity };
