const path = require("path");

const REQUIRED_GOLDEN_SCENARIOS = Object.freeze(["normal", "multilingual", "injection", "citation_fake", "cross_tenant", "stale_state", "schema_invalid"]);
const TASKS = Object.freeze([
  task("T01", "t01-company-context-draft", "createT01PromptDefinition", "mini", "test/t01-company-context-draft.test.js", { schemaFactory: "createT01OutputSchema" }),
  task("T02", "t02-relevance-class", "createT02PromptDefinition", "mini", "test/t02-relevance-class.test.js"),
  task("T03", "t03-relevance-rationale", "createT03PromptDefinition", "nano", "test/t03-relevance-rationale.test.js"),
  task("T04", "t04-issue-match", "createT04PromptDefinition", "nano", "test/t04-issue-match.test.js"),
  task("T05", "t05-issue-title", "createT05PromptDefinition", "nano", "test/t05-issue-title.test.js"),
  task("T06", "t06-issue-oneliner", "createT06PromptDefinition", "nano", "test/t06-issue-oneliner.test.js"),
  task("T07", "t07-issue-analysis", "createT07PromptDefinition", "mini", "test/t07-issue-analysis.test.js"),
  task("T08", "t08-claim-labels", "createT08PromptDefinition", "nano", "test/t08-claim-labels.test.js"),
  task("T09", "t09-priority-enum", "createT09PromptDefinition", "nano", "test/t09-priority-enum.test.js"),
  task("T10", "t10-priority-reason", "createT10PromptDefinition", "mini", "test/t10-priority-reason.test.js"),
  task("T12", "t12-direct-blurbs", "createT12PromptDefinition", "nano", "test/t12-direct-blurbs.test.js"),
  task("T13", "t13-report-narrative", "createT13PromptDefinition", "mini", "test/t13-report-narrative.test.js"),
  task("T14", "t14-constrained-rewrite", "createT14PromptDefinition", "nano", "test/t14-constrained-rewrite.test.js"),
]);

function task(taskId, directory, definitionFactory, model, serviceEvidence, extra = {}) {
  return Object.freeze({ taskId, directory, definitionFactory, model, serviceEvidence, scenarios: REQUIRED_GOLDEN_SCENARIOS, ...extra });
}

function validateGoldenCandidate({ rootDir, nanoModel, miniModel }) {
  const failures = [];
  for (const spec of TASKS) {
    const taskDir = path.join(rootDir, "src", "ai", "tasks", spec.directory);
    const promptPath = path.join(taskDir, "prompt.js");
    const servicePath = path.join(taskDir, "service.js");
    const evidencePath = path.join(rootDir, spec.serviceEvidence);
    const prompt = require(promptPath);
    const definition = require(path.join(taskDir, "definition.js"))[spec.definitionFactory]({ modelName: spec.model === "nano" ? nanoModel : miniModel });
    const schemaModule = require(path.join(taskDir, "schema.js"));
    const outputSchema = spec.schemaFactory ? schemaModule[spec.schemaFactory](["golden-source-1"]) : schemaModule[`T${spec.taskId.slice(1)}_OUTPUT_SCHEMA`];
    if (definition.status !== "active" || definition.modelCompatibility.length !== 1 || definition.modelCompatibility[0] !== (spec.model === "nano" ? nanoModel : miniModel)) failures.push(`${spec.taskId}: active model contract invalid`);
    if (!prompt.SYSTEM_POLICY?.match(/data, never as instructions/i) || !require("fs").readFileSync(promptPath, "utf8").includes("<UNTRUSTED")) failures.push(`${spec.taskId}: injection boundary missing`);
    if (!outputSchema?.schema || outputSchema.schema.additionalProperties !== false) failures.push(`${spec.taskId}: strict output schema missing`);
    if (!require("fs").existsSync(servicePath) || !require("fs").existsSync(evidencePath)) failures.push(`${spec.taskId}: service regression evidence missing`);
    if (new Set(spec.scenarios).size !== REQUIRED_GOLDEN_SCENARIOS.length || REQUIRED_GOLDEN_SCENARIOS.some((scenario) => !spec.scenarios.includes(scenario))) failures.push(`${spec.taskId}: golden scenario matrix incomplete`);
  }
  return { passed: failures.length === 0, taskCount: TASKS.length, scenariosPerTask: REQUIRED_GOLDEN_SCENARIOS.length, failures };
}

function assertReleasePromotion({ rootDir, nanoModel, miniModel, approvedBy }) {
  const result = validateGoldenCandidate({ rootDir, nanoModel, miniModel });
  if (!result.passed) throw new Error(`Prompt release gate failed: ${result.failures.join("; ")}`);
  if (typeof approvedBy !== "string" || !approvedBy.trim()) throw new Error("Prompt release promotion requires an explicit human approver");
  return { ...result, approvedBy: approvedBy.trim() };
}

module.exports = { REQUIRED_GOLDEN_SCENARIOS, TASKS, validateGoldenCandidate, assertReleasePromotion };
