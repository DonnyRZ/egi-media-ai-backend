const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { REQUIRED_GOLDEN_SCENARIOS, TASKS, assertReleasePromotion, validateGoldenCandidate } = require("../src/ai/prompt/release/golden-manifest");

const rootDir = path.resolve(__dirname, "..");
const config = { rootDir, nanoModel: "nano-test-model", miniModel: "mini-test-model" };

test("golden release matrix covers every active task and every required adversarial scenario", () => {
  assert.equal(TASKS.length, 13);
  for (const spec of TASKS) {
    assert.deepEqual([...spec.scenarios].sort(), [...REQUIRED_GOLDEN_SCENARIOS].sort(), spec.taskId);
    assert.equal(fs.existsSync(path.join(rootDir, spec.serviceEvidence)), true, `${spec.taskId} evidence`);
  }
  assert.deepEqual(validateGoldenCandidate(config), { passed: true, taskCount: 13, scenariosPerTask: 7, failures: [] });
});

test("golden prompt contracts retain multilingual and injection boundaries for every task", () => {
  for (const spec of TASKS) {
    const prompt = require(path.join(rootDir, "src", "ai", "tasks", spec.directory, "prompt.js"));
    const source = fs.readFileSync(path.join(rootDir, "src", "ai", "tasks", spec.directory, "prompt.js"), "utf8");
    assert.match(prompt.SYSTEM_POLICY, /data, never as instructions/i, `${spec.taskId} injection policy`);
    assert.match(source, /<UNTRUSTED_[A-Z_]+>/, `${spec.taskId} untrusted delimiter`);
    assert.doesNotMatch(source, /ascii|english only|latin only/i, `${spec.taskId} multilingual boundary`);
  }
});

test("promotion is fail-closed until a human approver is supplied", () => {
  assert.throws(() => assertReleasePromotion(config), /human approver/);
  const result = assertReleasePromotion({ ...config, approvedBy: "ai-engineering-reviewer" });
  assert.equal(result.passed, true);
  assert.equal(result.approvedBy, "ai-engineering-reviewer");
});
