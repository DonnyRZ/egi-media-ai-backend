"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { checkManagementIdentityQuality } = require("../src/ai/identity/quality-checks");

test("identity quality checks accept you-voice leadership drafts", () => {
  const result = checkManagementIdentityQuality({
    company_name: "Northwind Payments",
    identity: "You are the management and leadership of Northwind Payments. You focus on strategic decisions.",
    lens_summary: "You are the leadership of Northwind Payments.",
  }, { fields: { name: "Northwind Payments" } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("identity quality checks reject we/our and catalog dumps", () => {
  const result = checkManagementIdentityQuality({
    company_name: "Example Co",
    identity: "We are Example Co. Our products include a product catalog of SKUs.",
    lens_summary: "Our lens.",
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("identity_must_start_with_you_are")
    || result.failures.includes("identity_uses_we_our_us"));
});

test("eval identity-quality-cases matrix stays green", () => {
  const casesPath = path.join(__dirname, "../eval/management-intelligence/identity-quality-cases.json");
  const payload = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  for (const item of payload.cases) {
    const result = checkManagementIdentityQuality(item.identity, { fields: item.fields });
    const expectOk = item.expect_ok !== false;
    assert.equal(result.ok, expectOk, item.id);
    if (Array.isArray(item.expect_failures_any)) {
      assert.ok(
        item.expect_failures_any.some((code) => result.failures.includes(code)),
        `${item.id} expected one of ${item.expect_failures_any.join(",")}`,
      );
    }
  }
});

test("production-cases.json remains present for hospitality pilot regression", () => {
  const casesPath = path.join(__dirname, "../eval/management-intelligence/production-cases.json");
  assert.ok(fs.existsSync(casesPath));
  const payload = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  assert.ok(payload.context?.fields || Array.isArray(payload.cases));
});
