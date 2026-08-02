const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLogger, createRotatingFileStream, safeValue, safeError, REDACTED } = require("../src/observability");
const { mapError, sendError } = require("../src/app/error-contract");
const { normalizeProviderError } = require("../src/ai/provider/provider.errors");

test("S49 logger emits structured JSON, supports fatal, redacts secrets, and strips controls", () => {
  const lines = [];
  const logger = createLogger({ stream: { log: (line) => lines.push(line) }, service: "test-service" });
  logger.fatal("test_failure", { password: "secret", apiKey: "key", message: "line\nnext", safe: "ok" });
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.level, "fatal");
  assert.equal(entry.event, "test_failure");
  assert.equal(entry.password, REDACTED);
  assert.equal(entry.apiKey, REDACTED);
  assert.equal(entry.safe, "ok");
  assert.doesNotMatch(lines[0], /secret|key|\nnext/);
});

test("S49 safe error keeps diagnosis without exposing a cause stack or secret", () => {
  const error = Object.assign(new Error("provider failed"), { code: "AI_PROVIDER_REJECTED", status: 400, details: { providerErrorCode: "invalid_request", prompt: "secret prompt" } });
  const safe = safeError(error);
  assert.deepEqual(safe, { name: "Error", code: "AI_PROVIDER_REJECTED", message: "provider failed", status: 400, retryable: false, details: { providerErrorCode: "invalid_request", prompt: REDACTED } });
  assert.equal(safeValue({ authorization: "Bearer secret" }).authorization, REDACTED);
});

test("S57 maps unknown failures to UNKNOWN_INTERNAL_ERROR without leaking internals", () => {
  const mapped = mapError(new Error("database password leaked"));
  assert.deepEqual(mapped, { status: 500, code: "UNKNOWN_INTERNAL_ERROR", message: "Internal server error", retryable: false });
});

test("S53 preserves safe provider diagnostics for rejected requests", () => {
  const normalized = normalizeProviderError({ status: 400, request_id: "provider-request", error: { type: "invalid_request_error", code: "context_length_exceeded", message: "private provider detail" } });
  assert.equal(normalized.code, "AI_PROVIDER_REJECTED");
  assert.deepEqual(normalized.details, { status: 400, providerRequestId: "provider-request", providerErrorType: "invalid_request_error", providerErrorCode: "context_length_exceeded", retryAfterMs: 0, resetRequestsMs: 0, resetTokensMs: 0 });
});

test("S51 error envelope remains client-safe while logger receives the root cause", () => {
  const lines = [];
  const logger = createLogger({ stream: { log: (line) => lines.push(line) } });
  const body = {};
  const res = { locals: {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  const req = { method: "POST", path: "/test", requestId: "request-1", correlationId: "correlation-1", app: { locals: { logger } } };
  const error = Object.assign(new Error("private database detail"), { code: "AI_PROVIDER_REJECTED", statusCode: 502, details: { providerErrorCode: "context_length_exceeded" } });
  sendError(res, req, error);
  assert.equal(res.body.error.message, "AI provider rejected the request");
  assert.match(lines.join("\n"), /context_length_exceeded/);
  assert.doesNotMatch(lines.join("\n"), /private database detail/);
  assert.deepEqual(body, {});
});

test("S60 rotating file stream bounds configured file output", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "egi-ai-log-"));
  const file = path.join(dir, "app.log");
  const stream = createRotatingFileStream(file, 20);
  stream.write("12345678901234567890\n");
  stream.write("next-entry\n");
  assert.ok(fs.existsSync(file));
  assert.ok(fs.readdirSync(dir).some((name) => name.startsWith("app.log.")));
  fs.rmSync(dir, { recursive: true, force: true });
});
