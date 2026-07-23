const assert = require("node:assert/strict");
const test = require("node:test");

const { AiTaskKernel } = require("../src/ai/kernel/ai-task-kernel");

const outputSchema = {
  name: "kernel_smoke_output",
  schema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
};

function createKernel(create) {
  return new AiTaskKernel({
    openaiClient: { responses: { create } },
    openaiConfig: {
      nanoModel: "nano-test-model",
      miniModel: "mini-test-model",
    },
    defaultTimeoutMs: 1200,
    uuid: () => "generated-correlation-id",
  });
}

test("uses the configured Nano model and strict structured output", async () => {
  let request;
  let options;
  const kernel = createKernel(async (receivedRequest, receivedOptions) => {
    request = receivedRequest;
    options = receivedOptions;
    return {
      id: "resp_123",
      _request_id: "req_123",
      output_text: '{"value":"ok"}',
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
  });

  const result = await kernel.execute({
    model: "nano",
    input: [{ role: "system", content: "Kernel test only" }],
    outputSchema,
    requestId: "caller-correlation-id",
    timeoutMs: 900,
  });

  assert.equal(request.model, "nano-test-model");
  assert.equal(request.store, false);
  assert.deepEqual(request.text.format, {
    type: "json_schema",
    name: "kernel_smoke_output",
    strict: true,
    schema: outputSchema.schema,
  });
  assert.equal(options.timeout, 900);
  assert.equal(options.headers["X-Client-Request-Id"], "caller-correlation-id");
  assert.deepEqual(result.data, { value: "ok" });
  assert.deepEqual(result.correlation, {
    requestId: "caller-correlation-id",
    providerRequestId: "req_123",
  });
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test("uses Mini and creates a correlation ID when the caller does not provide one", async () => {
  const kernel = createKernel(async (request) => {
    assert.equal(request.model, "mini-test-model");
    return { output_text: '{"value":"ok"}' };
  });

  const result = await kernel.execute({ model: "mini", input: "test", outputSchema });

  assert.equal(result.correlation.requestId, "generated-correlation-id");
  assert.equal(result.model.name, "mini-test-model");
});

test("fails closed when provider output is not JSON or does not match the schema", async (t) => {
  await t.test("invalid JSON", async () => {
    const kernel = createKernel(async () => ({ output_text: "not-json" }));
    await assert.rejects(
      kernel.execute({ model: "nano", input: "test", outputSchema }),
      { code: "AI_OUTPUT_INVALID_JSON" },
    );
  });

  await t.test("schema mismatch", async () => {
    const kernel = createKernel(async () => ({ output_text: '{"unexpected":true}' }));
    await assert.rejects(
      kernel.execute({ model: "nano", input: "test", outputSchema }),
      { code: "AI_OUTPUT_SCHEMA_INVALID" },
    );
  });
});

test("normalizes retryable provider failures", async () => {
  const rateLimited = Object.assign(new Error("slow down"), { status: 429 });
  const kernel = createKernel(async () => { throw rateLimited; });

  await assert.rejects(
    kernel.execute({ model: "nano", input: "test", outputSchema }),
    (error) => error.code === "AI_PROVIDER_RATE_LIMITED" && error.retryable === true,
  );
});
