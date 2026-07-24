const test = require("node:test");
const assert = require("node:assert/strict");
const { AutomationDownstreamBoundary } = require("../src/automation/downstream-boundary");

test("S49 downstream boundary is fail-closed and never auto-shares a report", async () => {
  const boundary = new AutomationDownstreamBoundary({ logger: { info() {} } });
  const event = await boundary.evaluate({ tenantId: "t", companyId: "c", issueId: "i", pipelineId: "p" });
  assert.equal(event.alert.status, "suppressed");
  assert.equal(event.report.auto_created, false);
  assert.equal(event.report.status, "candidate");
});
