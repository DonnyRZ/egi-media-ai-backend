const test = require("node:test");
const assert = require("node:assert/strict");

const config = require("../../src/config/global_config");
const { InMemoryIssueStore } = require("../../src/issues");
const { InMemoryIssueAnalysisStore } = require("../../src/ai/tasks/t07-issue-analysis");
const { InMemoryAlertEventStore } = require("../../src/alerts");
const { InMemoryDirectAlertBlurbStore, T12_PROMPT_VERSION } = require("../../src/ai/tasks/t12-direct-blurbs");
const { InMemoryRecipientStore, InMemoryEmailDeliveryStore, EmailDeliveryService, createSmtpProvider } = require("../../src/delivery");

const emailConfig = config.get("/email");
const recipientEmail = process.env.EMAIL_TEST_RECIPIENT;
const enabled = process.env.RUN_EMAIL_INTEGRATION_TESTS === "true" && Boolean(recipientEmail);
const skipReason = enabled ? undefined : "set RUN_EMAIL_INTEGRATION_TESTS=true and explicit EMAIL_TEST_RECIPIENT";

function buildRuntime({ provider, withRecipient = true } = {}) {
  const tenantId = "tenant-s25";
  const companyId = "company-s25";
  const issueId = "issue-s25";
  const developmentId = "development-s25";
  const recipientId = "recipient-s25";
  const issueStore = new InMemoryIssueStore({ uuid: () => "generated-s25", now: () => 0 });
  const analysisStore = new InMemoryIssueAnalysisStore({ uuid: () => "analysis-s25", now: () => 0 });
  const analysis = analysisStore.create({ tenantId, companyId, issueId, contextVersion: 1, inputFingerprint: "s25-fingerprint", promptVersion: "1.0.0", analysis: { what_happened: "Konten uji S25.", why_matters: "Memverifikasi delivery.", impacts: [], risks: [], watch: [], claims: [{ claim_id: "claim-s25", text: "Konten uji S25.", source_article_ids: ["article-s25"] }] }, evidence: [], provenance: {} });
  analysisStore.promoteCurrent({ tenantId, companyId, analysisId: analysis.analysisId, gate: { gateStatus: "passed" } });
  issueStore.seed({ issueId, tenantId, companyId, title: "[S25 TEST] Gmail delivery terkontrol", oneLiner: "Email ini adalah pengujian terkontrol S25.", status: "berkembang", currentPriority: "tinggi", currentPriorityAnalysisId: analysis.analysisId, currentPriorityDecisionId: "priority-s25", firstSeenAt: "2026-07-23T00:00:00.000Z", lastDevelopedAt: "2026-07-23T00:00:00.000Z", version: 1, closedAt: null, createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z" });
  issueStore.developmentsById.set(developmentId, { developmentId, tenantId, companyId, issueId, issueArticleId: "issue-article-s25", developmentType: "created", observedAt: "2026-07-23T00:00:00.000Z" });
  issueStore.issueArticlesByKey.set("article-key-s25", { issueArticleId: "issue-article-s25", tenantId, companyId, issueId, canonicalUrl: "https://portal.example/id/articles/article-s25" });
  const eventStore = new InMemoryAlertEventStore({ uuid: () => "event-s25", now: () => 0 });
  const event = eventStore.create({ tenantId, companyId, issueId, developmentId, recipientId, channel: "langsung", status: "eligible", reasonCode: "s25_controlled_test", dedupeKey: "s25-dedupe" });
  const blurbStore = new InMemoryDirectAlertBlurbStore({ uuid: () => "blurb-s25", now: () => 0 });
  blurbStore.create({ tenantId, companyId, issueId, developmentId, alertEventId: event.alertEventId, promptVersion: T12_PROMPT_VERSION, newDevelopmentBlurb: "Perkembangan uji dikirim melalui Gmail.", shortImpactBlurb: "Tidak ada dampak bisnis; ini email kontrol.", sourceClaimIds: ["claim-s25"], provenance: {} });
  const recipientStore = new InMemoryRecipientStore();
  if (withRecipient) recipientStore.upsert({ tenantId, companyId, recipientId, email: recipientEmail || "recipient@example.com" });
  const deliveryStore = new InMemoryEmailDeliveryStore({ uuid: () => "delivery-s25", now: () => 0 });
  const service = new EmailDeliveryService({
    eventStore, blurbStore, issueStore, analysisStore, recipientStore, deliveryStore,
    provider: provider || { send: async () => ({ providerMessageId: "fake-s25" }) },
    emailConfig: { ...emailConfig, retry: { maxAttempts: 1, baseDelayMs: 0 } },
    authorizeCompany: async ({ tenantId: actualTenant, companyId: actualCompany, action }) => actualTenant === tenantId && actualCompany === companyId && action === "email.delivery.send",
    sleep: async () => {},
  });
  return { service, eventStore, event, deliveryStore, tenantId, companyId };
}

test("S25 fail-closed blocks missing required fields and audits the alert event", async () => {
  let providerCalls = 0;
  const runtime = buildRuntime({ withRecipient: false, provider: { send: async () => { providerCalls += 1; return {}; } } });
  await assert.rejects(runtime.service.deliver({ tenantId: runtime.tenantId, companyId: runtime.companyId, alertEventId: runtime.event.alertEventId }), { code: "BUSINESS_RULE_FAILED" });
  assert.equal(providerCalls, 0);
  assert.equal(runtime.deliveryStore.list().length, 0);
  const auditedEvent = runtime.eventStore.get({ tenantId: runtime.tenantId, companyId: runtime.companyId, alertEventId: runtime.event.alertEventId });
  assert.equal(auditedEvent.status, "blocked_delivery_fields");
  assert.equal(auditedEvent.reasonCode, "delivery_required_field_missing");
});

test("S25 real Gmail SMTP verifies connection and sends one controlled email with delivery audit", { timeout: 90000, skip: skipReason }, async () => {
  const provider = createSmtpProvider({ emailConfig });
  await provider.verify();
  const runtime = buildRuntime({ provider });
  const result = await runtime.service.deliver({ tenantId: runtime.tenantId, companyId: runtime.companyId, alertEventId: runtime.event.alertEventId });
  assert.equal(result.delivery.status, "sent");
  assert.equal(result.delivery.attempts.length, 1);
  assert.equal(result.delivery.attempts[0].outcome, "sent");
  assert.match(result.delivery.recipientEmailHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(result.delivery, "recipientEmail"), false);
  assert.equal(typeof result.delivery.subject, "string");
});
