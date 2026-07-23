const path = require("path");
const { assertReleasePromotion, validateGoldenCandidate } = require("../src/ai/prompt/release/golden-manifest");

const rootDir = path.resolve(__dirname, "..");
const config = { rootDir, nanoModel: process.env.OPENAI_NANO_MODEL || "gpt-5-nano-2025-08-07", miniModel: process.env.OPENAI_MINI_MODEL || "gpt-5-mini-2025-08-07" };
const promote = process.argv.includes("--promote");
try {
  const result = promote ? assertReleasePromotion({ ...config, approvedBy: process.env.PROMPT_RELEASE_APPROVER }) : validateGoldenCandidate(config);
  process.stdout.write(`${JSON.stringify({ mode: promote ? "promotion" : "candidate", ...result }, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Prompt release gate failed: ${error.message}\n`);
  process.exitCode = 1;
}
