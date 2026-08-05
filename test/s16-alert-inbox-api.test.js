const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createAlertRouter } = require("../src/routes/alerts");
const { InMemoryAlertEventStore } = require("../src/alerts");
const { InMemoryDirectAlertBlurbStore, T12_PROMPT_VERSION } = require("../src/ai/tasks/t12-direct-blurbs");

const scope = { tenantId: "tenant-inbox", companyId: "company-inbox", recipientId: "actor-inbox" };

function listen(runtime, blurbStore) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authContext = { actor: { actorId: scope.recipientId }, tenantId: scope.tenantId, companyId: scope.companyId, scopeTrusted: true };
    next();
  });
  app.use(createAlertRouter({ getAlertRuntime: () => runtime, getAlertBlurbStore: () => blurbStore }));
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("S16 inbox exposes channel filters, unread counts, and scoped T12 brief content", async () => {
  const events = new InMemoryAlertEventStore({ uuid: (() => { let n = 0; return () => `event-inbox-${++n}`; })(), now: () => 0 });
  const direct = events.create({ ...scope, issueId: "issue-direct", developmentId: "development-direct", channel: "langsung", status: "delivered", reasonCode: "high_priority", dedupeKey: "dedupe-direct" });
  events.create({ ...scope, issueId: "issue-digest", developmentId: "development-digest", channel: "ringkasan", status: "delivered", reasonCode: "daily_digest", dedupeKey: "dedupe-digest" });
  const blurbs = new InMemoryDirectAlertBlurbStore({ uuid: () => "blurb-inbox", now: () => 0 });
  blurbs.create({ ...scope, issueId: direct.issueId, developmentId: direct.developmentId, alertEventId: direct.alertEventId, promptVersion: T12_PROMPT_VERSION, newDevelopmentBlurb: "Regulator mempercepat penerapan aturan.", shortImpactBlurb: "Jadwal kepatuhan dan biaya operasi perlu ditinjau.", sourceClaimIds: ["claim-inbox"], provenance: { task: "T12" } });
  const server = await listen({ eventStore: events }, blurbs);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const directResponse = await fetch(`${base}/api/v1/inbox/emails?channel=langsung`);
    const directBody = await directResponse.json();
    assert.equal(directResponse.status, 200);
    assert.equal(directBody.data.items.length, 1);
    assert.equal(directBody.data.items[0].alert_content.new_development, "Regulator mempercepat penerapan aturan.");
    assert.equal(directBody.data.meta.unread_by_channel.langsung, 1);
    assert.equal(directBody.data.meta.unread_by_channel.ringkasan, 1);

    const detailResponse = await fetch(`${base}/api/v1/inbox/emails/${direct.alertEventId}`);
    const detailBody = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detailBody.data.alert_content.source_claim_ids[0], "claim-inbox");

    const invalid = await fetch(`${base}/api/v1/inbox/emails?channel=unknown`);
    assert.equal(invalid.status, 400);

    const marked = await fetch(`${base}/api/v1/inbox/emails/${direct.alertEventId}/read`, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": "inbox-read-test-001" }, body: JSON.stringify({ read: true }) });
    assert.equal(marked.status, 200);
    const after = await (await fetch(`${base}/api/v1/inbox/emails?channel=langsung`)).json();
    assert.equal(after.data.meta.unread_by_channel.langsung, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
