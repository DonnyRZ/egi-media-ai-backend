const assert = require("node:assert/strict");
const test = require("node:test");

const { createT02RelevanceRuntime } = require("../src/ai/tasks/t02-relevance-class");

const articleId = "123e4567-e89b-12d3-a456-426614174000";
const companyId = "company-1";

function context() {
  return {
    companyId,
    version: 3,
    status: "effective",
    fields: {
      name: "PT Example", industry: "Logistics", sub_industry: null, description: null,
      products: ["Fleet tracking"], customers: [], regions: ["Indonesia"], competitors: [],
      priorities: ["Reduce costs"], goals: [], risks: [], topics: [], dependencies: [],
    },
  };
}

function source() {
  return {
    sourceArticleId: articleId,
    requestedLocale: "id",
    contentLocale: "id",
    canonicalUrl: `https://portal.example/id/articles/${articleId}`,
    article: {
      id: articleId,
      title: "New logistics regulation",
      summary: "A new regulation affects fleet operators.",
      content: "This full article body must not be sent to T02.",
      status: "published",
      publishedAt: "2026-07-22T10:00:00.000Z",
      updatedAt: "2026-07-22T11:00:00.000Z",
    },
  };
}

function buildRuntime({ output = { relevance: "none", confidence: 0.91 }, contextResult = context(), cmsError, onKernelRequest } = {}) {
  let kernelCalls = 0;
  const runtime = createT02RelevanceRuntime({
    aiTaskKernel: {
      execute: async (request) => {
        kernelCalls += 1;
        onKernelRequest?.(request);
        return {
          data: output,
          model: { alias: "nano", name: "nano-test-model" },
          correlation: { requestId: request.requestId, providerRequestId: "req_t02" },
          providerResponseId: "resp_t02",
          usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
          latencyMs: 18,
        };
      },
    },
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    cmsSourceGate: {
      requirePublishedArticle: async () => {
        if (cmsError) throw cmsError;
        return source();
      },
    },
    getEffectiveContext: async () => contextResult,
    authorizeCompany: async ({ companyId: authorizedCompanyId, action }) => authorizedCompanyId === companyId && action === "relevance.classify",
  });
  return { runtime, kernelCalls: () => kernelCalls };
}

test("T02 classifies one article for one effective context and stops on none", async () => {
  let input;
  const { runtime, kernelCalls } = buildRuntime({ onKernelRequest: (request) => { input = request.input; } });

  const result = await runtime.service.classify({ companyId, articleId, locale: "id" });

  assert.equal(kernelCalls(), 1);
  assert.equal(result.decision.relevance, "none");
  assert.equal(result.decision.confidence, 0.91);
  assert.equal(result.decision.contextVersion, 3);
  assert.equal(result.decision.branch, "stop");
  assert.equal(result.shouldContinue, false);
  assert.equal(result.reused, false);
  assert.match(input[1].content, /<TRUSTED_CONTEXT>/);
  assert.match(input[1].content, /<UNTRUSTED_ARTICLE_DATA>/);
  assert.match(input[1].content, /New logistics regulation/);
  assert.doesNotMatch(input[1].content, /This full article body must not be sent to T02/);
  assert.equal(runtime.decisionStore.list().length, 1);
});

test("T02 reuses the same article snapshot × company × context version decision", async () => {
  const { runtime, kernelCalls } = buildRuntime({ output: { relevance: "high", confidence: 0.8 } });

  const first = await runtime.service.classify({ companyId, articleId, locale: "id" });
  const second = await runtime.service.classify({ companyId, articleId, locale: "id" });

  assert.equal(first.shouldContinue, true);
  assert.equal(second.reused, true);
  assert.equal(kernelCalls(), 1);
  assert.equal(runtime.decisionStore.list().length, 1);
});

test("T02 fails closed for invalid output without persisting a decision", async () => {
  const { runtime } = buildRuntime({ output: { relevance: "high", confidence: 1.2 } });

  await assert.rejects(
    runtime.service.classify({ companyId, articleId, locale: "id" }),
    { code: "AI_OUTPUT_SCHEMA_INVALID" },
  );
  assert.deepEqual(runtime.decisionStore.list(), []);
  assert.equal(runtime.runStore.list()[0].validationOutcome, "failed");
});

test("T02 does not call the model when the CMS source or effective context gate fails", async (t) => {
  await t.test("CMS rejects article", async () => {
    const sourceError = Object.assign(new Error("not published"), { code: "CMS_SOURCE_NOT_PUBLISHED" });
    const { runtime, kernelCalls } = buildRuntime({ cmsError: sourceError });
    await assert.rejects(runtime.service.classify({ companyId, articleId, locale: "id" }), { code: "CMS_SOURCE_NOT_PUBLISHED" });
    assert.equal(kernelCalls(), 0);
  });

  await t.test("effective context is absent", async () => {
    const { runtime, kernelCalls } = buildRuntime({ contextResult: null });
    await assert.rejects(runtime.service.classify({ companyId, articleId, locale: "id" }), { code: "AI_CONFIGURATION_INVALID" });
    assert.equal(kernelCalls(), 0);
  });
});
