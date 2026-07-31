"use strict";

/**
 * Generate management identity with Luna from company context fields.
 *
 * Usage:
 *   node scripts/generate-management-identity.js path/to/context-fields.json
 *   node scripts/generate-management-identity.js path/to/context-fields.json --out out.json
 *
 * Input JSON may be:
 *   { ...fields }
 *   { "fields": { ...fields } }
 *   { "context": { "fields": { ...fields }, "version": 1 } }
 *
 * Requires OPENAI_API_KEY and model env (OPENAI_MINI_MODEL / OPENAI_MODEL).
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const config = require("../src/config/global_config");
const {
  createAiTaskKernel,
  PromptRegistry,
  PromptExecutionService,
  InMemoryPromptRunStore,
} = require("../src/ai");
const {
  MANAGEMENT_IDENTITY_PROMPT_ID,
  MANAGEMENT_IDENTITY_PROMPT_VERSION,
  MANAGEMENT_IDENTITY_OUTPUT_SCHEMA,
  createManagementIdentityPromptDefinition,
  buildManagementIdentityDraftInput,
  validateManagementIdentityOutput,
  fingerprintManagementIdentity,
} = require("../src/ai/identity");

function usage() {
  console.error("Usage: node scripts/generate-management-identity.js <context-fields.json> [--out <file>]");
  process.exit(1);
}

function loadFields(absolutePath) {
  const raw = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  if (raw?.context?.fields && typeof raw.context.fields === "object") {
    return {
      fields: raw.context.fields,
      contextVersion: raw.context.version ?? raw.version ?? null,
      companyId: raw.companyId || raw.company_id || raw.context.companyId || null,
    };
  }
  if (raw?.fields && typeof raw.fields === "object") {
    return {
      fields: raw.fields,
      contextVersion: raw.version ?? raw.context_version ?? null,
      companyId: raw.companyId || raw.company_id || null,
    };
  }
  return {
    fields: raw,
    contextVersion: null,
    companyId: null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args[0] || args[0] === "--help") usage();

  let outPath = null;
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--out") {
      outPath = args[i + 1];
      i += 1;
      continue;
    }
    positional.push(args[i]);
  }
  if (!positional[0]) usage();

  const absolute = path.resolve(process.cwd(), positional[0]);
  if (!fs.existsSync(absolute)) {
    console.error(`File not found: ${absolute}`);
    process.exit(1);
  }

  const openaiConfig = config.get("/openai");
  if (!openaiConfig.apiKey) {
    console.error("OPENAI_API_KEY is required");
    process.exit(1);
  }
  if (!openaiConfig.miniModel && !openaiConfig.model) {
    console.error("OPENAI_MINI_MODEL or OPENAI_MODEL is required");
    process.exit(1);
  }

  const { fields, contextVersion, companyId } = loadFields(absolute);
  const modelName = openaiConfig.miniModel || openaiConfig.model;
  const registry = new PromptRegistry([
    createManagementIdentityPromptDefinition({ modelName }),
  ]);
  const execution = new PromptExecutionService({
    promptRegistry: registry,
    aiTaskKernel: createAiTaskKernel(),
    runStore: new InMemoryPromptRunStore(),
    openaiConfig,
  });

  console.error(`Generating management identity with model=${modelName} …`);
  const result = await execution.executeActive({
    promptId: MANAGEMENT_IDENTITY_PROMPT_ID,
    promptVersion: MANAGEMENT_IDENTITY_PROMPT_VERSION,
    model: "mini",
    timeoutMs: openaiConfig.timeoutMs || 60000,
    input: buildManagementIdentityDraftInput({ companyId, contextVersion, fields }),
    outputSchema: MANAGEMENT_IDENTITY_OUTPUT_SCHEMA,
    validateResult: (data) => validateManagementIdentityOutput(data, { fields }),
  });

  const draft = validateManagementIdentityOutput(result.data, { fields });
  const payload = {
    ...draft,
    fingerprint: fingerprintManagementIdentity(draft),
    provenance: {
      model: result.provenance?.model || modelName,
      promptId: MANAGEMENT_IDENTITY_PROMPT_ID,
      promptVersion: MANAGEMENT_IDENTITY_PROMPT_VERSION,
      contextVersion,
      companyId,
      providerRequestId: result.provenance?.providerRequestId || result.provenance?.requestId || null,
    },
  };

  const text = JSON.stringify(payload, null, 2);
  console.log(text);
  if (outPath) {
    const outAbsolute = path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(outAbsolute), { recursive: true });
    fs.writeFileSync(outAbsolute, `${text}\n`, "utf8");
    console.error(`Wrote ${outAbsolute}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
});
