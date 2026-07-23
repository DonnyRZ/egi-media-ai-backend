const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryIssueStore } = require("../src/issues");
const { InMemoryIssueAnalysisStore } = require("../src/ai/tasks/t07-issue-analysis");
const { InMemoryIssuePriorityStore, T09_PROMPT_VERSION } = require("../src/ai/tasks/t09-priority-enum");
const { InMemoryPriorityReasonStore, T10_PROMPT_VERSION } = require("../src/ai/tasks/t10-priority-reason");
const { InMemoryAlertEventStore } = require("../src/alerts");
const { createT12DirectBlurbsRuntime } = require("../src/ai/tasks/t12-direct-blurbs");

const tenantId = "tenant-h";
const companyId = "company-a";
const issueId = "issue-1";
const developmentId = "development-1";

function buildRuntime({ output = validOutput(), channel = "langsung", status = "eligible", withArticle = true, onKernelRequest } = {}) {
  const issueStore = new InMemoryIssueStore({ uuid: () => "generated-id", now: () => 0 });
  const analysisStore = new InMemoryIssueAnalysisStore({ uuid: () => "analysis-1", now: () => 0 });
  const priorityStore = new InMemoryIssuePriorityStore({ uuid: () => "priority-1", now: () => 0 });
  const reasonStore = new InMemoryPriorityReasonStore({ uuid: () => "reason-1", now: () => 0 });
  const analysis = analysisStore.create({
    tenantId, companyId, issueId, contextVersion: 3, inputFingerprint: "analysis-fp", promptVersion: "1.0.0",
    analysis: {
      what_happened: "Regulasi diumumkan.", why_matters: "Kepatuhan berubah.", impacts: [], risks: [], watch: [],
      claims: [{ claim_id: "c1", text: "Regulasi menyasar operator logistik.", source_article_ids: ["source-1"] }],
    }, evidence: [], provenance: {},
  });
  analysisStore.promoteCurrent({ tenantId, companyId, analysisId: analysis.analysisId, gate: { gateStatus: "passed" } });
  const priority = priorityStore.create({ tenantId, companyId, issueId, analysisId: analysis.analysisId, contextVersion: 3, promptVersion: T09_PROMPT_VERSION, priority: "tinggi", provenance: {} });
  reasonStore.create({ tenantId, companyId, issueId, analysisId: analysis.analysisId, priorityDecisionId: priority.priorityDecisionId, promptVersion: T10_PROMPT_VERSION, reason: "Priority reason.", sourceClaimIds: ["c1"], provenance: {} });
  issueStore.seed({
    issueId, tenantId, companyId, title: "Perubahan regulasi logistik", oneLiner: "Ketentuan baru diumumkan.", status: "berkembang", currentPriority: "tinggi",
    currentPriorityAnalysisId: analysis.analysisId, currentPriorityDecisionId: priority.priorityDecisionId,
    firstSeenAt: "2026-07-22T10:00:00.000Z", lastDevelopedAt: "2026-07-22T11:00:00.000Z", version: 3, closedAt: null,
    createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T11:00:00.000Z",
  });
  issueStore.developmentsById.set(developmentId, { developmentId, tenantId, companyId, issueId, issueArticleId: "issue-article-1", developmentType: "created", observedAt: "2026-07-22T11:00:00.000Z" });
  if (withArticle) issueStore.issueArticlesByKey.set("article-key", { issueArticleId: "issue-article-1", tenantId, companyId, issueId, canonicalUrl: "https://portal.example/id/articles/source-1" });
  const eventStore = new InMemoryAlertEventStore({ uuid: () => "event-1", now: () => 0 });
  const event = eventStore.create({ tenantId, companyId, issueId, developmentId, recipientId: "user-1", channel, status, reasonCode: "high_new_issue", dedupeKey: "dedupe-1" });
  let kernelCalls = 0;
  const runtime = createT12DirectBlurbsRuntime({
    aiTaskKernel: { execute: async (request) => {
      kernelCalls += 1; onKernelRequest?.(request);
      return { data: output, model: { alias: "nano", name: "nano-test-model" }, correlation: { requestId: request.requestId, providerRequestId: "req_t12" }, providerResponseId: "resp_t12", usage: { inputTokens: 30, outputTokens: 20, totalTokens: 50 }, latencyMs: 10 };
    } },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" }, eventStore, issueStore, analysisStore, priorityStore, reasonStore,
    authorizeCompany: async (scope) => scope.tenantId === tenantId && scope.companyId === companyId && scope.action === "alert.direct_blurb.generate",
  });
  return { runtime, eventStore, event, kernelCalls: () => kernelCalls };
}

function validOutput() {
  return { new_development_blurb: "Regulasi baru diumumkan untuk operator logistik.", short_impact_blurb: "Perusahaan perlu meninjau kepatuhan operasional.", source_claim_ids: ["c1"] };
}

test("T12 uses Nano only after backend selected an eligible direct alert and stores no email", async () => {
  let request;
  const { runtime, event, kernelCalls } = buildRuntime({ onKernelRequest: (value) => { request = value; } });
  const result = await runtime.service.generate({ tenantId, companyId, alertEventId: event.alertEventId });
  assert.equal(kernelCalls(), 1);
  assert.equal(result.reused, false);
  assert.equal(result.blurb.newDevelopmentBlurb, "Regulasi baru diumumkan untuk operator logistik.");
  assert.deepEqual(result.blurb.sourceClaimIds, ["c1"]);
  assert.equal(request.model, "nano");
  assert.match(request.input[1].content, /"canonical_detail_url":"https:\/\/portal\.example\/id\/articles\/source-1"/);
  assert.match(request.input[1].content, /"forbidden":\["URL","recipient","subject","email body"/);
  assert.equal(Object.hasOwn(result.blurb, "recipient"), false);
  assert.equal(Object.hasOwn(result.blurb, "email"), false);
});

test("T12 is idempotent for the same eligible direct alert event", async () => {
  const { runtime, event, kernelCalls } = buildRuntime();
  const first = await runtime.service.generate({ tenantId, companyId, alertEventId: event.alertEventId });
  const second = await runtime.service.generate({ tenantId, companyId, alertEventId: event.alertEventId });
  assert.equal(second.reused, true);
  assert.equal(second.blurb.directBlurbId, first.blurb.directBlurbId);
  assert.equal(kernelCalls(), 1);
});

test("T12 rejects a non-direct or non-eligible event before invoking Nano", async (t) => {
  for (const [name, options] of [["digest", { channel: "ringkasan" }], ["suppressed", { status: "suppressed" }]]) {
    await t.test(name, async () => {
      const { runtime, event, kernelCalls } = buildRuntime(options);
      await assert.rejects(runtime.service.generate({ tenantId, companyId, alertEventId: event.alertEventId }), { code: "AI_CONFIGURATION_INVALID" });
      assert.equal(kernelCalls(), 0);
      assert.deepEqual(runtime.blurbStore.list(), []);
    });
  }
});

test("T12 fails closed: invalid output or input gate blocks the alert event and creates no email", async (t) => {
  await t.test("invalid output", async () => {
    const { runtime, event, eventStore } = buildRuntime({ output: { new_development_blurb: "Only one field", short_impact_blurb: "Impact", source_claim_ids: ["invented"] } });
    await assert.rejects(runtime.service.generate({ tenantId, companyId, alertEventId: event.alertEventId }), { code: "AI_OUTPUT_SCHEMA_INVALID" });
    assert.deepEqual(runtime.blurbStore.list(), []);
    assert.equal(eventStore.get({ tenantId, companyId, alertEventId: event.alertEventId }).status, "blocked_invalid_content");
    assert.equal(eventStore.get({ tenantId, companyId, alertEventId: event.alertEventId }).reasonCode, "invalid_blurb_output");
  });
  await t.test("missing canonical detail URL", async () => {
    const { runtime, event, eventStore, kernelCalls } = buildRuntime({ withArticle: false });
    await assert.rejects(runtime.service.generate({ tenantId, companyId, alertEventId: event.alertEventId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
    assert.equal(eventStore.get({ tenantId, companyId, alertEventId: event.alertEventId }).status, "blocked_invalid_content");
    assert.equal(eventStore.get({ tenantId, companyId, alertEventId: event.alertEventId }).reasonCode, "direct_blurb_gate_failed");
  });
});
