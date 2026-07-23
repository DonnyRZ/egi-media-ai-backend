const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryIssueStore } = require("../src/issues");
const { InMemoryIssueAnalysisStore } = require("../src/ai/tasks/t07-issue-analysis");
const { InMemoryAlertEventStore } = require("../src/alerts");
const { InMemoryDirectAlertBlurbStore, T12_PROMPT_VERSION } = require("../src/ai/tasks/t12-direct-blurbs");
const { InMemoryRecipientStore, InMemoryEmailDeliveryStore, EmailDeliveryService } = require("../src/delivery");

const tenantId = "tenant-h";
const companyId = "company-a";
const issueId = "issue-1";
const developmentId = "development-1";
const recipientId = "user-1";

function buildRuntime({ provider, withRecipient = true, withBlurb = true, withUrl = true, retry = { maxAttempts: 3, baseDelayMs: 0 } } = {}) {
  const issueStore = new InMemoryIssueStore({ uuid: () => "generated-id", now: () => 0 });
  const analysisStore = new InMemoryIssueAnalysisStore({ uuid: () => "analysis-1", now: () => 0 });
  const analysis = analysisStore.create({ tenantId, companyId, issueId, contextVersion: 3, inputFingerprint: "fp", promptVersion: "1.0.0", analysis: { what_happened: "x", why_matters: "x", impacts: [], risks: [], watch: [], claims: [{ claim_id: "c1", text: "x", source_article_ids: ["source-1"] }] }, evidence: [], provenance: {} });
  analysisStore.promoteCurrent({ tenantId, companyId, analysisId: analysis.analysisId, gate: { gateStatus: "passed" } });
  issueStore.seed({ issueId, tenantId, companyId, title: "Perubahan regulasi logistik", oneLiner: "Ketentuan baru diumumkan.", status: "berkembang", currentPriority: "tinggi", currentPriorityAnalysisId: analysis.analysisId, currentPriorityDecisionId: "priority-1", firstSeenAt: "2026-07-22T10:00:00.000Z", lastDevelopedAt: "2026-07-22T11:00:00.000Z", version: 3, closedAt: null, createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T11:00:00.000Z" });
  issueStore.developmentsById.set(developmentId, { developmentId, tenantId, companyId, issueId, issueArticleId: "issue-article-1", developmentType: "created", observedAt: "2026-07-22T11:00:00.000Z" });
  if (withUrl) issueStore.issueArticlesByKey.set("article-key", { issueArticleId: "issue-article-1", tenantId, companyId, issueId, canonicalUrl: "https://portal.example/id/articles/source-1" });
  const eventStore = new InMemoryAlertEventStore({ uuid: () => "event-1", now: () => 0 });
  const event = eventStore.create({ tenantId, companyId, issueId, developmentId, recipientId, channel: "langsung", status: "eligible", reasonCode: "high_new_issue", dedupeKey: "dedupe-1" });
  const blurbStore = new InMemoryDirectAlertBlurbStore({ uuid: () => "blurb-1", now: () => 0 });
  if (withBlurb) blurbStore.create({ tenantId, companyId, issueId, developmentId, alertEventId: event.alertEventId, promptVersion: T12_PROMPT_VERSION, newDevelopmentBlurb: "Regulasi baru diumumkan.", shortImpactBlurb: "Kepatuhan operasional perlu ditinjau.", sourceClaimIds: ["c1"], provenance: {} });
  const recipientStore = new InMemoryRecipientStore();
  if (withRecipient) recipientStore.upsert({ tenantId, companyId, recipientId, email: "recipient@example.com" });
  const deliveryStore = new InMemoryEmailDeliveryStore({ uuid: (() => { let i = 0; return () => `delivery-${++i}`; })(), now: () => 0 });
  const pauses = [];
  const service = new EmailDeliveryService({
    eventStore, blurbStore, issueStore, analysisStore, recipientStore, deliveryStore,
    provider: provider || { send: async () => ({ providerMessageId: "provider-1" }) },
    emailConfig: { from: { address: "egi.egiholding@gmail.com", name: "EGI Media" }, retry },
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "email.delivery.send",
    sleep: async (ms) => { pauses.push(ms); },
  });
  return { service, eventStore, event, deliveryStore, pauses };
}

test("email adapter renders a backend template, audits delivery, and never asks a model for recipient or subject", async () => {
  let message;
  const { service, event, deliveryStore } = buildRuntime({ provider: { send: async (value) => { message = value; return { providerMessageId: "gmail-message-1" }; } } });
  const result = await service.deliver({ tenantId, companyId, alertEventId: event.alertEventId });
  assert.equal(result.delivery.status, "sent");
  assert.equal(message.to, "recipient@example.com");
  assert.equal(message.subject, "[EGI Media] Prioritas tinggi: Perubahan regulasi logistik");
  assert.match(message.text, /Regulasi baru diumumkan/);
  assert.match(message.text, /Ketentuan baru diumumkan/);
  assert.match(message.html, /portal\.example/);
  assert.equal(Object.hasOwn(service, "aiTaskKernel"), false);
  const audit = deliveryStore.list()[0];
  assert.equal(Object.hasOwn(audit, "recipientEmail"), false);
  assert.match(audit.recipientEmailHash, /^[a-f0-9]{64}$/);
  assert.equal(audit.attempts.length, 1);
});

test("email adapter retries only retryable provider failures with the same delivery intent", async () => {
  let calls = 0;
  const provider = { send: async () => { calls += 1; if (calls < 3) { const error = new Error("timeout"); error.code = "ETIMEDOUT"; throw error; } return { providerMessageId: "gmail-message-3" }; } };
  const { service, event, deliveryStore, pauses } = buildRuntime({ provider, retry: { maxAttempts: 3, baseDelayMs: 10 } });
  const result = await service.deliver({ tenantId, companyId, alertEventId: event.alertEventId });
  assert.equal(calls, 3);
  assert.equal(result.delivery.status, "sent");
  assert.deepEqual(pauses, [10, 20]);
  assert.deepEqual(deliveryStore.list()[0].attempts.map((attempt) => attempt.outcome), ["retrying", "retrying", "sent"]);
});

test("email adapter is idempotent after a successful send and does not issue a second provider call", async () => {
  let calls = 0;
  const { service, event } = buildRuntime({ provider: { send: async () => { calls += 1; return { providerMessageId: "gmail-message-1" }; } } });
  const first = await service.deliver({ tenantId, companyId, alertEventId: event.alertEventId });
  const second = await service.deliver({ tenantId, companyId, alertEventId: event.alertEventId });
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(calls, 1);
});

test("missing delivery fields fail closed before provider send and audit the alert event", async (t) => {
  for (const [name, options] of [["recipient", { withRecipient: false }], ["blurb", { withBlurb: false }], ["canonical URL", { withUrl: false }]]) {
    await t.test(name, async () => {
      let calls = 0;
      const { service, event, eventStore, deliveryStore } = buildRuntime({ ...options, provider: { send: async () => { calls += 1; return {}; } } });
      await assert.rejects(service.deliver({ tenantId, companyId, alertEventId: event.alertEventId }), { code: "BUSINESS_RULE_FAILED" });
      assert.equal(calls, 0);
      assert.deepEqual(deliveryStore.list(), []);
      assert.equal(eventStore.get({ tenantId, companyId, alertEventId: event.alertEventId }).status, "blocked_delivery_fields");
    });
  }
});

test("non-retryable provider failure is audited and does not retry blindly", async () => {
  let calls = 0;
  const provider = { send: async () => { calls += 1; const error = new Error("rejected"); error.code = "EAUTH"; throw error; } };
  const { service, event, deliveryStore, pauses } = buildRuntime({ provider });
  const result = await service.deliver({ tenantId, companyId, alertEventId: event.alertEventId });
  assert.equal(calls, 1);
  assert.equal(result.delivery.status, "failed");
  assert.equal(result.delivery.errorCode, "EAUTH");
  assert.deepEqual(pauses, []);
  assert.equal(deliveryStore.list()[0].attempts[0].outcome, "failed");
});
