const assert = require("node:assert/strict");
const test = require("node:test");

const { InMemoryRelevanceDecisionStore } = require("../src/ai/tasks/t02-relevance-class");
const { createT03RelevanceRationaleRuntime } = require("../src/ai/tasks/t03-relevance-rationale");
const { fingerprint } = require("../src/ai/tasks/t02-relevance-class/service");

const articleId = "123e4567-e89b-12d3-a456-426614174000";
const companyId = "company-1";

function context() {
  return {
    companyId, version: 3, status: "effective",
    fields: {
      name: "PT Example", industry: "Logistics", sub_industry: null, description: null,
      products: ["Fleet tracking"], customers: [], regions: ["Indonesia"], competitors: [],
      priorities: ["Reduce costs"], goals: [], risks: [], topics: [], dependencies: [],
    },
  };
}

function source({ updatedAt = "2026-07-22T11:00:00.000Z" } = {}) {
  return {
    sourceArticleId: articleId, requestedLocale: "id", contentLocale: "id",
    canonicalUrl: `https://portal.example/id/articles/${articleId}`,
    article: {
      id: articleId, title: "New logistics regulation", summary: "A new regulation affects fleet operators.",
      content: "This full article body must not be sent to T03.", status: "published",
      publishedAt: "2026-07-22T10:00:00.000Z", updatedAt,
    },
  };
}

function buildRuntime({ output = { rationale: "The regulation directly affects the company's fleet-tracking operations." }, sourceResult = source(), onKernelRequest } = {}) {
  const decisionStore = new InMemoryRelevanceDecisionStore({ uuid: () => "decision-1", now: () => 0 });
  const initialSource = source();
  const decision = decisionStore.create({
    articleId, companyId, contextVersion: 3,
    inputFingerprint: fingerprint({ source: initialSource, contextVersion: 3 }),
    source: initialSource, output: { relevance: "high", confidence: 0.9 },
    provenance: { runId: "run-t02" },
  });
  let kernelCalls = 0;
  const runtime = createT03RelevanceRationaleRuntime({
    aiTaskKernel: {
      execute: async (request) => {
        kernelCalls += 1;
        onKernelRequest?.(request);
        return {
          data: output, model: { alias: "nano", name: "nano-test-model" },
          correlation: { requestId: request.requestId, providerRequestId: "req_t03" },
          providerResponseId: "resp_t03", usage: { inputTokens: 20, outputTokens: 9, totalTokens: 29 }, latencyMs: 16,
        };
      },
    },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    cmsSourceGate: { requirePublishedArticle: async () => sourceResult },
    getCompanyContextVersion: async () => context(),
    decisionStore,
    authorizeCompany: async ({ companyId: authorizedCompanyId, action }) => authorizedCompanyId === companyId && action === "relevance.rationale",
  });
  return { runtime, decisionStore, decision, kernelCalls: () => kernelCalls };
}

test("T03 generates an optional rationale without changing the stored T02 label", async () => {
  let input;
  const { runtime, decisionStore, decision, kernelCalls } = buildRuntime({ onKernelRequest: (request) => { input = request.input; } });
  const before = decisionStore.getById(decision.decisionId);

  const result = await runtime.service.generate({ companyId, decisionId: decision.decisionId });

  assert.equal(kernelCalls(), 1);
  assert.equal(result.reused, false);
  assert.equal(result.rationale.rationale, "The regulation directly affects the company's fleet-tracking operations.");
  assert.deepEqual(decisionStore.getById(decision.decisionId), before);
  assert.equal(result.decision.relevance, "high");
  assert.match(input[1].content, /relevance_label_immutable/);
  assert.match(input[1].content, /New logistics regulation/);
  assert.doesNotMatch(input[1].content, /This full article body must not be sent to T03/);
  assert.equal(runtime.rationaleStore.list().length, 1);
});

test("T03 reuses an existing optional rationale and never invokes the model again", async () => {
  const { runtime, decision, kernelCalls } = buildRuntime();
  await runtime.service.generate({ companyId, decisionId: decision.decisionId });
  const second = await runtime.service.generate({ companyId, decisionId: decision.decisionId });
  assert.equal(second.reused, true);
  assert.equal(kernelCalls(), 1);
});

test("T03 fails closed when output attempts to include a relevance label", async () => {
  const { runtime, decisionStore, decision } = buildRuntime({
    output: { rationale: "It is relevant.", relevance: "low" },
  });
  const before = decisionStore.getById(decision.decisionId);

  await assert.rejects(runtime.service.generate({ companyId, decisionId: decision.decisionId }), { code: "AI_OUTPUT_SCHEMA_INVALID" });
  assert.deepEqual(decisionStore.getById(decision.decisionId), before);
  assert.deepEqual(runtime.rationaleStore.list(), []);
  assert.equal(runtime.runStore.list()[0].validationOutcome, "failed");
});

test("T03 does not call the model when the T02 article snapshot is stale or decision is unavailable", async (t) => {
  await t.test("stale source", async () => {
    const { runtime, decision, kernelCalls } = buildRuntime({ sourceResult: source({ updatedAt: "2026-07-23T11:00:00.000Z" }) });
    await assert.rejects(runtime.service.generate({ companyId, decisionId: decision.decisionId }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });

  await t.test("unknown decision", async () => {
    const { runtime, kernelCalls } = buildRuntime();
    await assert.rejects(runtime.service.generate({ companyId, decisionId: "missing" }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });
});
