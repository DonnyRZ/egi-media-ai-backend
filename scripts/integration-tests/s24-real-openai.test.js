const test = require("node:test");
const assert = require("node:assert/strict");

const config = require("../../src/config/global_config");
const { createAiTaskKernel, PromptRegistry, PromptExecutionService, InMemoryPromptRunStore } = require("../../src/ai");
const { T02_PROMPT_ID, T02_PROMPT_VERSION, createT02PromptDefinition } = require("../../src/ai/tasks/t02-relevance-class/definition");
const { T02_OUTPUT_SCHEMA } = require("../../src/ai/tasks/t02-relevance-class/schema");
const { validateT02Output } = require("../../src/ai/tasks/t02-relevance-class/output-validator");
const { OpenAiIntegrationBudget, withRetry } = require("./openai-integration-guard");

const openaiConfig = config.get("/openai");
const enabled = process.env.RUN_OPENAI_INTEGRATION_TESTS === "true"
  && Boolean(openaiConfig.apiKey && openaiConfig.nanoModel && openaiConfig.miniModel);
const skipReason = enabled ? undefined : "set RUN_OPENAI_INTEGRATION_TESTS=true, OPENAI_API_KEY, OPENAI_NANO_MODEL, and OPENAI_MINI_MODEL";
const integrationBudget = new OpenAiIntegrationBudget({
  maxRequests: Number(process.env.OPENAI_INTEGRATION_MAX_REQUESTS || 4),
  maxTokens: Number(process.env.OPENAI_INTEGRATION_MAX_TOKENS || 8000),
});

function createExecution(definition) {
  const registry = new PromptRegistry([definition]);
  return new PromptExecutionService({
    promptRegistry: registry,
    aiTaskKernel: createAiTaskKernel(),
    runStore: new InMemoryPromptRunStore(),
    openaiConfig,
  });
}

test("S24 retry policy retries a timeout and stops at the configured attempt limit", async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("synthetic timeout"), { name: "APIConnectionTimeoutError" });
    return "ok";
  }, { maxAttempts: 2 });
  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("S24 retry policy does not retry non-retryable provider failures", async () => {
  let attempts = 0;
  await assert.rejects(() => withRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error("synthetic auth failure"), { status: 401 });
  }, { maxAttempts: 2 }), { code: "AI_PROVIDER_AUTHENTICATION_FAILED", retryable: false });
  assert.equal(attempts, 1);
});

test("S24 real Nano returns schema-valid T02 structured output", { timeout: 120000, skip: skipReason }, async () => {
  const execution = createExecution(createT02PromptDefinition({ modelName: openaiConfig.nanoModel }));
  const result = await withRetry(async () => {
    integrationBudget.reserveRequest("nano");
    return execution.executeActive({
      promptId: T02_PROMPT_ID,
      promptVersion: T02_PROMPT_VERSION,
      model: "nano",
      timeoutMs: openaiConfig.timeoutMs,
      input: [{ role: "user", content: JSON.stringify({ company_id: "s24-company", company_context: { industry: "logistics", priorities: ["cost control"] }, article: { title: "New logistics fuel regulation", summary: "A published regulation may affect fleet operators.", locale: "id" } }) }],
      outputSchema: T02_OUTPUT_SCHEMA,
      validateResult: validateT02Output,
    });
  });
  integrationBudget.recordUsage(result.usage, "nano");
  assert.ok(["high", "medium", "low", "none"].includes(result.data.relevance));
  assert.ok(Number.isFinite(result.data.confidence));
  assert.ok(result.provenance.providerRequestId || result.provenance.requestId);
});

test("S24 real Mini returns schema-valid T02 structured output", { timeout: 120000, skip: skipReason }, async () => {
  const execution = createExecution(createT02PromptDefinition({ modelName: openaiConfig.miniModel }));
  const result = await withRetry(async () => {
    integrationBudget.reserveRequest("mini");
    return execution.executeActive({
      promptId: T02_PROMPT_ID,
      promptVersion: T02_PROMPT_VERSION,
      model: "mini",
      timeoutMs: openaiConfig.timeoutMs,
      input: [{ role: "user", content: JSON.stringify({ company_id: "s24-company", company_context: { industry: "logistics", priorities: ["cost control"] }, article: { title: "New logistics fuel regulation", summary: "A published regulation may affect fleet operators.", locale: "id" } }) }],
      outputSchema: T02_OUTPUT_SCHEMA,
      validateResult: validateT02Output,
    });
  });
  integrationBudget.recordUsage(result.usage, "mini");
  assert.ok(["high", "medium", "low", "none"].includes(result.data.relevance));
  assert.ok(Number.isFinite(result.data.confidence));
  assert.ok(result.provenance.providerRequestId || result.provenance.requestId);
});
