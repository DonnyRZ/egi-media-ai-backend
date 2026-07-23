const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiTaskKernel } = require("../../src/ai");
const { PromptRegistry } = require("../../src/ai/prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../../src/ai/prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../../src/ai/provenance/prompt-run.store");
const { createT02PromptDefinition, T02_PROMPT_ID, T02_PROMPT_VERSION, T02_OUTPUT_SCHEMA } = require("../../src/ai/tasks/t02-relevance-class");
const { validateT02Output } = require("../../src/ai/tasks/t02-relevance-class/output-validator");
const config = require("../../src/config/global_config");

test("S08 real Nano API returns schema-valid T02 output", { timeout: 120000, skip: !process.env.RUN_OPENAI_INTEGRATION_TESTS || !process.env.OPENAI_API_KEY || !process.env.OPENAI_NANO_MODEL }, async () => {
  const openaiConfig = config.get("/openai");
  const registry = new PromptRegistry([createT02PromptDefinition({ modelName: openaiConfig.nanoModel })]);
  const execution = new PromptExecutionService({ promptRegistry: registry, aiTaskKernel: createAiTaskKernel(), runStore: new InMemoryPromptRunStore(), openaiConfig });
  const result = await execution.executeActive({
    promptId: T02_PROMPT_ID,
    promptVersion: T02_PROMPT_VERSION,
    model: "nano",
    input: [{ role: "user", content: JSON.stringify({ company_id: "company-test", company_context: { industry: "logistics", priorities: ["cost control"] }, article: { title: "New logistics fuel regulation", summary: "A published regulation may affect fleet operators.", locale: "id" } }) }],
    outputSchema: T02_OUTPUT_SCHEMA,
    validateResult: validateT02Output,
  });
  assert.ok(["high", "medium", "low", "none"].includes(result.data.relevance));
  assert.equal(typeof result.data.confidence, "number");
  assert.ok(result.provenance.providerRequestId || result.provenance.requestId);
});
