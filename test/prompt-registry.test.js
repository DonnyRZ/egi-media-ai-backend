const assert = require("node:assert/strict");
const test = require("node:test");

const { PromptRegistry } = require("../src/ai/prompt/registry/prompt-registry");
const { PromptExecutionService } = require("../src/ai/prompt/prompt-execution.service");
const { InMemoryPromptRunStore } = require("../src/ai/provenance/prompt-run.store");

function definition(overrides = {}) {
  return {
    promptId: "KERNEL_SMOKE",
    version: "1.0.0",
    status: "draft",
    owner: "ai-engineering",
    modelCompatibility: ["nano-test-model"],
    inputSchemaVersion: "1.0",
    outputSchemaVersion: "1.0",
    changeSummary: "initial contract",
    ...overrides,
  };
}

test("registry retains immutable versions and resolves only the active version", () => {
  const registry = new PromptRegistry([
    definition({ version: "1.0.0", status: "draft" }),
    definition({ version: "1.1.0", status: "active", approvedBy: "reviewer-1" }),
  ]);

  const active = registry.requireActive({ promptId: "KERNEL_SMOKE", modelName: "nano-test-model" });
  assert.equal(active.version, "1.1.0");
  assert.throws(
    () => registry.requireActive({ promptId: "KERNEL_SMOKE", version: "1.0.0", modelName: "nano-test-model" }),
    { code: "PROMPT_VERSION_NOT_ACTIVE" },
  );
  assert.throws(
    () => registry.register(definition({ version: "1.1.0", status: "review" })),
    { code: "PROMPT_DEFINITION_INVALID" },
  );
  assert.throws(
    () => registry.register(definition({ version: "1.2.0", status: "active" })),
    { code: "PROMPT_DEFINITION_INVALID" },
  );
  assert.equal(Object.isFrozen(active), true);
});

test("registry refuses active prompts incompatible with the selected model", () => {
  const registry = new PromptRegistry([definition({ status: "active" })]);

  assert.throws(
    () => registry.requireActive({ promptId: "KERNEL_SMOKE", modelName: "mini-test-model" }),
    { code: "PROMPT_MODEL_NOT_COMPATIBLE" },
  );
});

test("draft, review, and approved versions cannot reach the AI kernel", async () => {
  for (const status of ["draft", "review", "approved"]) {
    const registry = new PromptRegistry([definition({ status })]);
    const runStore = new InMemoryPromptRunStore();
    let kernelCalled = false;
    const service = new PromptExecutionService({
      promptRegistry: registry,
      aiTaskKernel: { execute: async () => { kernelCalled = true; } },
      runStore,
      openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    });

    await assert.rejects(
      service.executeActive({ promptId: "KERNEL_SMOKE", model: "nano", input: "input", outputSchema: { name: "test", schema: {} } }),
      { code: "PROMPT_VERSION_NOT_ACTIVE" },
    );
    assert.equal(kernelCalled, false);
    assert.deepEqual(runStore.list(), []);
  }
});

test("active execution records successful prompt provenance without raw input or output", async () => {
  const registry = new PromptRegistry([definition({ status: "active" })]);
  const runStore = new InMemoryPromptRunStore();
  const kernel = {
    execute: async (request) => {
      assert.equal(request.requestId, "request-id");
      return {
        data: { ignoredByProvenance: true },
        model: { alias: "nano", name: "nano-test-model" },
        correlation: { requestId: request.requestId, providerRequestId: "req_1" },
        providerResponseId: "resp_1",
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
        latencyMs: 44,
      };
    },
  };
  const service = new PromptExecutionService({
    promptRegistry: registry,
    aiTaskKernel: kernel,
    runStore,
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    uuid: (() => { const values = ["run-id", "request-id"]; return () => values.shift(); })(),
    now: () => 0,
  });

  const result = await service.executeActive({
    promptId: "KERNEL_SMOKE",
    model: "nano",
    input: "untrusted input is not persisted here",
    outputSchema: { name: "test", schema: {} },
  });

  assert.equal(result.prompt.version, "1.0.0");
  assert.equal(result.provenance.validationOutcome, "passed");
  assert.deepEqual(result.provenance.usage, { inputTokens: 12, outputTokens: 4, totalTokens: 16 });
  assert.equal("data" in result.provenance, false);
  assert.equal("input" in result.provenance, false);
  assert.deepEqual(runStore.list(), [result.provenance]);
});

test("failed output validation is recorded and rethrown", async () => {
  const registry = new PromptRegistry([definition({ status: "active" })]);
  const runStore = new InMemoryPromptRunStore();
  const kernel = {
    execute: async () => {
      const error = new Error("invalid output");
      error.code = "AI_OUTPUT_SCHEMA_INVALID";
      throw error;
    },
  };
  const service = new PromptExecutionService({
    promptRegistry: registry,
    aiTaskKernel: kernel,
    runStore,
    openaiConfig: { nanoModel: "nano-test-model", miniModel: "mini-test-model" },
    uuid: (() => { const values = ["run-id", "request-id"]; return () => values.shift(); })(),
    now: () => 1000,
  });

  await assert.rejects(
    service.executeActive({ promptId: "KERNEL_SMOKE", model: "nano", input: "input", outputSchema: { name: "test", schema: {} } }),
    { code: "AI_OUTPUT_SCHEMA_INVALID" },
  );

  const [run] = runStore.list();
  assert.equal(run.status, "failed");
  assert.equal(run.validationOutcome, "failed");
  assert.deepEqual(run.error, { code: "AI_OUTPUT_SCHEMA_INVALID", retryable: false });
});
