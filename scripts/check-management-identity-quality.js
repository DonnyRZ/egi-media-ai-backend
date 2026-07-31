#!/usr/bin/env node
"use strict";

/**
 * Offline management-identity quality gate.
 * Usage: node scripts/check-management-identity-quality.js [path-to-cases.json]
 */

const fs = require("fs");
const path = require("path");
const { checkManagementIdentityQuality } = require("../src/ai/identity/quality-checks");

const casesPath = process.argv[2]
  || path.join(__dirname, "../eval/management-intelligence/identity-quality-cases.json");

const payload = JSON.parse(fs.readFileSync(casesPath, "utf8"));
const cases = Array.isArray(payload.cases) ? payload.cases : [];
let failed = 0;

for (const item of cases) {
  const result = checkManagementIdentityQuality(item.identity, { fields: item.fields });
  const expectOk = item.expect_ok !== false;
  const ok = result.ok === expectOk
    && (!Array.isArray(item.expect_failures_any)
      || item.expect_failures_any.some((code) => result.failures.includes(code)));
  if (!ok) {
    failed += 1;
    console.error(`FAIL ${item.id}: ok=${result.ok} failures=${result.failures.join(",")}`);
  } else {
    console.log(`PASS ${item.id}`);
  }
}

if (failed > 0) {
  console.error(`identity quality checks failed: ${failed}/${cases.length}`);
  process.exit(1);
}

console.log(`identity quality checks passed: ${cases.length}/${cases.length}`);
