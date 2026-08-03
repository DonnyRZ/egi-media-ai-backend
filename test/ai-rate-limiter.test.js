const assert = require("node:assert/strict");
const test = require("node:test");

const { OpenAiRateLimiter } = require("../src/ai/provider/rate-limiter");
const { normalizeProviderError } = require("../src/ai/provider/provider.errors");

test("rate limiter enforces a shared concurrency lease", async () => {
  const limiter = new OpenAiRateLimiter({ maxConcurrency: 1, sleepFn: async () => {} });
  const first = await limiter.acquire({ model: "model-a", estimatedTokens: 100 });
  assert.equal(limiter.snapshot("model-a").active, 1);
  first.release({ actualTokens: 80 });
  const second = await limiter.acquire({ model: "model-a", estimatedTokens: 100 });
  assert.equal(limiter.snapshot("model-a").active, 1);
  second.release();
  assert.equal(limiter.snapshot("model-a").active, 0);
});

test("rate limiter honors a provider cooldown before the next request", async () => {
  let now = 0;
  const pauses = [];
  const limiter = new OpenAiRateLimiter({
    maxConcurrency: 1,
    now: () => now,
    sleepFn: async (delayMs) => { pauses.push(delayMs); now += delayMs; },
  });
  limiter.observeRateLimit({ model: "model-a", retryAfterMs: 2500 });
  const lease = await limiter.acquire({ model: "model-a" });
  lease.release();
  assert.deepEqual(pauses, [2500]);
});

test("normalizes rate-limit headers without losing token-based provider signals", () => {
  const error = Object.assign(new Error("rate limited"), {
    status: 429,
    error: { type: "tokens", code: "rate_limit_exceeded" },
    headers: {
      "retry-after": "2",
      "x-ratelimit-reset-requests": "1s",
      "x-ratelimit-reset-tokens": "6m0s",
    },
  });
  const normalized = normalizeProviderError(error);
  assert.equal(normalized.code, "AI_PROVIDER_RATE_LIMITED");
  assert.equal(normalized.details.providerErrorType, "tokens");
  assert.equal(normalized.details.retryAfterMs, 2000);
  assert.equal(normalized.details.resetRequestsMs, 1000);
  assert.equal(normalized.details.resetTokensMs, 360000);
});

test("normalizes generic provider connection failures as retryable unavailability", () => {
  const normalized = normalizeProviderError(new Error("Connection error."));
  assert.equal(normalized.code, "AI_PROVIDER_UNAVAILABLE");
  assert.equal(normalized.retryable, true);
});
