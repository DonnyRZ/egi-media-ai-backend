"use strict";

/**
 * Local pipeline: company profile PDF → T01 context draft → Luna management identity.
 *
 * Usage:
 *   node scripts/run-profile-to-identity.js company-profile-test/ACME_1_Company_Profile.pdf
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
  createT01CompanyContextDraftRuntime,
} = require("../src/ai");
const { extractPdfSource } = require("../src/company-context/pdf-source.service");
const {
  MANAGEMENT_IDENTITY_PROMPT_ID,
  MANAGEMENT_IDENTITY_PROMPT_VERSION,
  MANAGEMENT_IDENTITY_OUTPUT_SCHEMA,
  createManagementIdentityPromptDefinition,
  buildManagementIdentityDraftInput,
  validateManagementIdentityOutput,
  fingerprintManagementIdentity,
} = require("../src/ai/identity");
const { createT01PromptDefinition } = require("../src/ai/tasks/t01-company-context-draft/definition");

function usage() {
  console.error("Usage: node scripts/run-profile-to-identity.js <company-profile.pdf>");
  process.exit(1);
}

async function main() {
  const pdfArg = process.argv[2];
  if (!pdfArg) usage();

  const pdfPath = path.resolve(process.cwd(), pdfArg);
  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  const openaiConfig = config.get("/openai");
  if (!openaiConfig.apiKey) {
    console.error("OPENAI_API_KEY is required");
    process.exit(1);
  }
  const modelName = openaiConfig.miniModel || openaiConfig.model;
  if (!modelName) {
    console.error("OPENAI_MINI_MODEL or OPENAI_MODEL is required");
    process.exit(1);
  }

  const outDir = path.dirname(pdfPath);
  const baseName = path.basename(pdfPath, path.extname(pdfPath));
  const contextOut = path.join(outDir, `${baseName}.context.json`);
  const identityOut = path.join(outDir, `${baseName}.identity.json`);

  console.error(`1/3 Extracting PDF text: ${pdfPath}`);
  const buffer = fs.readFileSync(pdfPath);
  const source = await extractPdfSource({
    buffer,
    size: buffer.length,
    originalname: path.basename(pdfPath),
    mimetype: "application/pdf",
  });
  console.error(`    pages=${source.metadata.pageCount} chars=${source.text.length}`);

  console.error("2/3 Drafting company context (T01 / Luna)…");
  const t01Runtime = createT01CompanyContextDraftRuntime({
    authorizeCompany: async () => true,
  });
  const { draft, provenance: t01Provenance } = await t01Runtime.service.createDraft({
    tenantId: "local-test",
    trustedContext: {
      companyId: `local-${baseName}`.slice(0, 128),
      extractionLanguage: "en",
      actor: { actorId: "local-script", actorType: "human" },
      scopeTrusted: true,
      limits: {
        maxSources: 1,
        maxCharsPerSource: 100000,
        maxTotalChars: 100000,
      },
    },
    sources: [source],
  });

  const companyContextFields = draft?.result?.context || null;
  if (!companyContextFields) {
    const debugPath = path.join(outDir, `${baseName}.draft-debug.json`);
    fs.writeFileSync(debugPath, `${JSON.stringify({ draft, keys: Object.keys(draft || {}) }, null, 2)}\n`, "utf8");
    console.error(`Could not find context fields. Wrote ${debugPath}`);
    process.exit(1);
  }

  const contextFile = {
    companyId: `local-${baseName}`.slice(0, 128),
    version: 1,
    fields: companyContextFields,
    missing_fields: draft.result?.missing_fields || [],
    status: draft.result?.status || draft.status || null,
    source: {
      fileName: source.metadata.fileName,
      pageCount: source.metadata.pageCount,
      extractedCharacters: source.text.length,
      sourceLocator: source.sourceLocator,
    },
    provenance: {
      promptId: "T01_company_context_draft",
      model: t01Provenance?.model || modelName,
      providerRequestId: t01Provenance?.providerRequestId || t01Provenance?.requestId || null,
    },
  };
  fs.writeFileSync(contextOut, `${JSON.stringify(contextFile, null, 2)}\n`, "utf8");
  console.error(`    wrote ${contextOut}`);
  console.error(`    company=${companyContextFields.name || "(unnamed)"} industry=${companyContextFields.industry || "(none)"}`);

  console.error("3/3 Drafting management identity (Luna)…");
  const registry = new PromptRegistry([
    createT01PromptDefinition({ modelName }),
    createManagementIdentityPromptDefinition({ modelName }),
  ]);
  const execution = new PromptExecutionService({
    promptRegistry: registry,
    aiTaskKernel: createAiTaskKernel(),
    runStore: new InMemoryPromptRunStore(),
    openaiConfig,
  });

  const identityResult = await execution.executeActive({
    promptId: MANAGEMENT_IDENTITY_PROMPT_ID,
    promptVersion: MANAGEMENT_IDENTITY_PROMPT_VERSION,
    model: "mini",
    timeoutMs: Math.max(Number(openaiConfig.t01TimeoutMs || openaiConfig.timeoutMs || 30000), 120000),
    input: buildManagementIdentityDraftInput({
      companyId: contextFile.companyId,
      contextVersion: 1,
      fields: companyContextFields,
    }),
    outputSchema: MANAGEMENT_IDENTITY_OUTPUT_SCHEMA,
    validateResult: (data) => validateManagementIdentityOutput(data, { fields: companyContextFields }),
  });

  const identityDraft = validateManagementIdentityOutput(identityResult.data, {
    fields: companyContextFields,
  });
  const identityFile = {
    ...identityDraft,
    fingerprint: fingerprintManagementIdentity(identityDraft),
    provenance: {
      model: identityResult.provenance?.model || modelName,
      promptId: MANAGEMENT_IDENTITY_PROMPT_ID,
      promptVersion: MANAGEMENT_IDENTITY_PROMPT_VERSION,
      contextFile: path.basename(contextOut),
      providerRequestId: identityResult.provenance?.providerRequestId || identityResult.provenance?.requestId || null,
    },
  };
  fs.writeFileSync(identityOut, `${JSON.stringify(identityFile, null, 2)}\n`, "utf8");
  console.error(`    wrote ${identityOut}`);
  console.log("");
  console.log("=== identity ===");
  console.log(identityDraft.identity);
  console.log("");
  console.log("=== lens_summary ===");
  console.log(identityDraft.lens_summary);
  console.log("");
  console.log(JSON.stringify({ contextOut, identityOut, company_name: identityDraft.company_name }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  if (error.stack) console.error(error.stack);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
});
