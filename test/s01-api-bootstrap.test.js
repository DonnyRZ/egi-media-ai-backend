const test = require("node:test");
const assert = require("node:assert/strict");
const { createHealthHandlers } = require("../src/app/health");

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const validEnv = {
  SOURCE_DATABASE_URL: "postgresql://source:secret@localhost:5432/main",
  AI_DATABASE_URL: "postgresql://ai:secret@localhost:5432/ai",
};

test("S01 live health endpoint is available without database access", () => {
  const health = createHealthHandlers({ env: {} });
  const response = responseRecorder();
  health.live({}, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.status, "alive");
});

test("S01 readiness fails closed when environment is invalid", async () => {
  const health = createHealthHandlers({ env: {} });
  const response = responseRecorder();
  await health.ready({}, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error.code, "NOT_READY");
  assert.equal(response.body.meta.checks.environment, "failed");
});

test("S01 readiness checks both database dependencies", async () => {
  const calls = [];
  const runtime = {
    source: { healthCheck: async () => { calls.push("source"); return true; } },
    ai: { healthCheck: async () => { calls.push("ai"); return true; } },
  };
  const health = createHealthHandlers({ env: validEnv, getDatabaseRuntime: () => runtime });
  const response = responseRecorder();
  await health.ready({}, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, ["source", "ai"]);
  assert.deepEqual(response.body.meta.checks, { environment: "ok", source_database: "ok", ai_database: "ok" });
});

test("S01 readiness returns 503 when a database dependency fails", async () => {
  const runtime = {
    source: { healthCheck: async () => true },
    ai: { healthCheck: async () => { throw new Error("connection refused"); } },
  };
  const health = createHealthHandlers({ env: validEnv, getDatabaseRuntime: () => runtime });
  const response = responseRecorder();
  await health.ready({}, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.meta.checks.database, "failed");
});
