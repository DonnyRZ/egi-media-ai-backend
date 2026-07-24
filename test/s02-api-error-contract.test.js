const test = require("node:test");
const assert = require("node:assert/strict");
const { createHealthHandlers } = require("../src/app/health");
const { mapError, sendError } = require("../src/app/error-contract");
const { requestContextMiddleware } = require("../src/app/request-context");

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("S02 creates stable request and correlation IDs and response headers", () => {
  const req = { get: (name) => ({ "X-Request-Id": "request-123", "X-Correlation-Id": "trace-456" }[name]) };
  const res = responseRecorder();
  let nextCalled = false;
  requestContextMiddleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.requestId, "request-123");
  assert.equal(req.correlationId, "trace-456");
  assert.equal(res.headers["X-Request-Id"], "request-123");
  assert.equal(res.headers["X-Correlation-Id"], "trace-456");
});

test("S02 falls back to one generated ID when headers are absent", () => {
  const req = { get: () => undefined };
  const res = responseRecorder();
  requestContextMiddleware(req, res, () => {});
  assert.match(req.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(req.correlationId, req.requestId);
});

test("S02 maps AI provider and database failures without leaking internals", () => {
  assert.deepEqual(mapError(Object.assign(new Error("provider secret"), { code: "AI_PROVIDER_TIMEOUT", retryable: true })), {
    status: 504, code: "AI_PROVIDER_TIMEOUT", message: "AI provider timed out", retryable: true,
  });
  assert.deepEqual(mapError(Object.assign(new Error("password=secret"), { code: "ECONNREFUSED" })), {
    status: 503, code: "DATABASE_UNAVAILABLE", message: "Database service is unavailable", retryable: true,
  });
  assert.equal(mapError(Object.assign(new Error("duplicate"), { code: "23505" })).code, "DATABASE_CONSTRAINT");
});

test("S02 emits one consistent error envelope with both IDs", () => {
  const response = responseRecorder();
  sendError(response, { requestId: "req-1", correlationId: "corr-1" }, Object.assign(new Error("secret details"), { code: "AI_PROVIDER_UNAVAILABLE" }));
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    success: false,
    error: { code: "AI_PROVIDER_UNAVAILABLE", message: "AI provider is unavailable" },
    meta: { request_id: "req-1", correlation_id: "corr-1", retryable: true },
  });
  assert.equal(JSON.stringify(response.body).includes("secret details"), false);
});

test("S02 readiness database failure uses the same correlation-ready contract", async () => {
  const health = createHealthHandlers({
    env: { SOURCE_DATABASE_URL: "postgresql://s:x@localhost/s", AI_DATABASE_URL: "postgresql://a:x@localhost/a" },
    getDatabaseRuntime: () => ({ source: { healthCheck: async () => true }, ai: { healthCheck: async () => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }); } } }),
  });
  const response = responseRecorder();
  await health.ready({}, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error.code, "NOT_READY");
});
