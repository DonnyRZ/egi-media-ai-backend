"use strict";

/**
 * Production-case T02 replay + ablation harness.
 *
 * Default mode matches production: includeBodySnippet=false, consensus=3, mini model.
 * Ablation modes isolate root-cause hypotheses without changing prompts.
 *
 * Usage:
 *   node eval/management-intelligence/replay-production.js
 *   node eval/management-intelligence/replay-production.js --mode=baseline
 *   node eval/management-intelligence/replay-production.js --mode=with-body
 *   node eval/management-intelligence/replay-production.js --mode=synthetic-context
 *   node eval/management-intelligence/replay-production.js --mode=strip-broad-priorities
 *   node eval/management-intelligence/replay-production.js --mode=title-summary-only-content
 *   node eval/management-intelligence/replay-production.js --ids=FP-1,FP-2,TP-1
 *   node eval/management-intelligence/replay-production.js --ablation-matrix
 */

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const { createOpenAiClient } = require("../../src/ai/provider/openai.client");
const { AiTaskKernel } = require("../../src/ai/kernel/ai-task-kernel");
const { buildT02Input } = require("../../src/ai/tasks/t02-relevance-class/prompt");
const { T02_OUTPUT_SCHEMA } = require("../../src/ai/tasks/t02-relevance-class/schema");
const { validateT02Output } = require("../../src/ai/tasks/t02-relevance-class/output-validator");
const { mergeRelevanceOutputs } = require("../../src/ai/tasks/t02-relevance-class/service");
const { applySubjectIdentityGate } = require("../../src/ai/tasks/t02-relevance-class/subject-identity-gate");
const { applyMarketMaterialityGate } = require("../../src/ai/tasks/t02-relevance-class/market-materiality-gate");
const { shouldFormIssue } = require("../../src/ai/tasks/t02-relevance-class/relevance-policy");

const CASES_PATH = path.join(__dirname, "production-cases.json");
const RESULT_PATH = path.join(__dirname, "replay-result.json");

const NORTHSTAR_FIELDS = {
  name: "Northstar Lodging Collective",
  industry: "Lodging, dining, and guest services",
  sub_industry: null,
  description: null,
  products: ["Business accommodation", "Managed dining venues"],
  customers: [],
  regions: ["Metro One", "Island Two"],
  competitors: [],
  brands_aliases: [],
  key_people: [],
  priorities: ["Grow direct sales", "Protect guest demand"],
  goals: [],
  risks: [],
  topics: ["Guest experience", "Destination demand"],
  dependencies: [],
};

const BROAD_PRIORITY_RE = /keberlanjutan|efisiensi energi|efisiensi|sustainab|energi\/air|energi|talenta|sdm|loyalitas|digital|investor|ekspansi|portofolio/i;
const BROAD_TOPIC_RE = /keberlanjutan|energi|sdm|pelatihan|rantai pasok|sustainab/i;

function parseArgs(argv) {
  const args = {
    mode: "baseline",
    ids: null,
    ablationMatrix: false,
    passes: 3,
  };
  for (const raw of argv.slice(2)) {
    if (raw === "--ablation-matrix") args.ablationMatrix = true;
    else if (raw.startsWith("--mode=")) args.mode = raw.slice("--mode=".length);
    else if (raw.startsWith("--ids=")) args.ids = new Set(raw.slice("--ids=".length).split(",").map((s) => s.trim()).filter(Boolean));
    else if (raw.startsWith("--passes=")) args.passes = Math.max(1, Math.min(3, Number(raw.slice("--passes=".length)) || 3));
  }
  return args;
}

function stripBroadPriorities(fields) {
  return {
    ...fields,
    priorities: (fields.priorities || []).filter((p) => !BROAD_PRIORITY_RE.test(String(p))),
    topics: (fields.topics || []).filter((t) => !BROAD_TOPIC_RE.test(String(t))),
    goals: (fields.goals || []).filter((g) => !BROAD_PRIORITY_RE.test(String(g))),
  };
}

function applyMode(caseItem, context, mode) {
  const source = structuredClone(caseItem.source);
  let fields = structuredClone(context.fields);
  let includeBodySnippet = false;
  let bodySnippetChars = 1500;
  let note = "production-matching: title+summary only";

  if (mode === "with-body") {
    includeBodySnippet = true;
    bodySnippetChars = 2500;
    note = "H1: send body snippet like live-eval";
  } else if (mode === "synthetic-context") {
    fields = structuredClone(NORTHSTAR_FIELDS);
    note = "H2: replace Arunika context with synthetic Northstar";
  } else if (mode === "strip-broad-priorities") {
    fields = stripBroadPriorities(fields);
    note = "H2-field: remove broad aspirational priorities/topics/goals";
  } else if (mode === "title-summary-only-content") {
    // Keep production body off the model, but also blank content so identity gate cannot use body.
    source.article.content = "";
    note = "H1-gate: blank body for identity gate; model still title+summary";
  } else if (mode === "explicit-negative-summary") {
    source.article.summary = `${source.article.summary || ""} It reports no concrete hotel/resort/dining peer move, regulation, measured demand change, named property impact, or dependency change for the dashboard company.`.trim();
    note = "H3: append explicit negative clause like synthetic eval content";
  } else if (mode !== "baseline") {
    throw new Error(`Unknown mode: ${mode}`);
  }

  return {
    source,
    context: { ...context, fields },
    options: { includeBodySnippet, bodySnippetChars, useRubric: true },
    note,
  };
}

async function classifyCase({ kernel, caseItem, context, mode, passes }) {
  const configured = applyMode(caseItem, context, mode);
  const input = buildT02Input({
    companyId: configured.context.companyId,
    context: configured.context,
    source: configured.source,
    options: configured.options,
  });
  const passResults = [];
  for (let i = 0; i < passes; i += 1) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await kernel.execute({
          model: "mini",
          input,
          outputSchema: T02_OUTPUT_SCHEMA,
          requestId: randomUUID(),
        });
        passResults.push(validateT02Output(result.data));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error?.code !== "AI_PROVIDER_TIMEOUT" && error?.code !== "AI_PROVIDER_UNAVAILABLE") throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
    if (lastError) throw lastError;
  }
  const merged = mergeRelevanceOutputs(...passResults);
  const identity = applySubjectIdentityGate({
    relevance: merged.relevance,
    confidence: merged.confidence,
    subjectRelation: merged.subject_relation,
    fields: configured.context.fields,
    title: configured.source.article.title,
    summary: configured.source.article.summary,
    body: configured.source.article.content || "",
  });
  const materiality = applyMarketMaterialityGate({
    relevance: identity.relevance,
    confidence: identity.confidence,
    subjectRelation: identity.subjectRelation,
    fields: configured.context.fields,
    title: configured.source.article.title,
    summary: configured.source.article.summary,
  });
  const shouldContinue = shouldFormIssue({
    relevance: materiality.relevance,
    subjectRelation: identity.subjectRelation,
  });
  const branchStable = new Set(passResults.map((p) => shouldFormIssue({
    relevance: p.relevance,
    subjectRelation: p.subject_relation,
  }))).size === 1;
  return {
    id: caseItem.id,
    mode,
    note: configured.note,
    expectedContinue: caseItem.expectedContinue,
    productionContinue: caseItem.production?.branch === "continue",
    passes: passResults,
    merged,
    identity,
    materiality,
    shouldContinue,
    branchStable,
    matchesExpected: shouldContinue === caseItem.expectedContinue,
    matchesProduction: shouldContinue === (caseItem.production?.branch === "continue"),
  };
}

async function runMode({ kernel, fixture, mode, ids, passes }) {
  const selected = fixture.cases.filter((c) => !ids || ids.has(c.id));
  const results = [];
  for (const caseItem of selected) {
    process.stdout.write(`MODE=${mode} CASE=${caseItem.id} ... `);
    const record = await classifyCase({
      kernel,
      caseItem,
      context: fixture.context,
      mode,
      passes,
    });
    results.push(record);
    console.log(JSON.stringify({
      id: record.id,
      expected: record.expectedContinue,
      production: record.productionContinue,
      replay: record.shouldContinue,
      relevance: record.materiality.relevance,
      relation: record.identity.subjectRelation,
      hook: record.materiality.hook,
      gate: record.materiality.reason,
      matchExpected: record.matchesExpected,
      matchProduction: record.matchesProduction,
      stable: record.branchStable,
    }));
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  if (!fs.existsSync(CASES_PATH)) throw new Error(`Missing ${CASES_PATH}`);
  const fixture = JSON.parse(fs.readFileSync(CASES_PATH, "utf8"));

  const models = {
    nanoModel: process.env.OPENAI_NANO_MODEL || fixture.productionEnv?.OPENAI_NANO_MODEL || "gpt-5-nano",
    miniModel: process.env.OPENAI_MINI_MODEL || fixture.productionEnv?.OPENAI_MINI_MODEL || "gpt-5-mini",
  };
  const client = createOpenAiClient({ apiKey, timeoutMs: 180000 });
  const kernel = new AiTaskKernel({
    openaiClient: client,
    openaiConfig: models,
    defaultTimeoutMs: 180000,
  });

  const modes = args.ablationMatrix
    ? ["baseline", "with-body", "synthetic-context", "strip-broad-priorities", "explicit-negative-summary"]
    : [args.mode];

  const byMode = {};
  for (const mode of modes) {
    byMode[mode] = await runMode({
      kernel,
      fixture,
      mode,
      ids: args.ids,
      passes: args.passes,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    models,
    productionEnv: fixture.productionEnv,
    modes,
    summary: Object.fromEntries(Object.entries(byMode).map(([mode, rows]) => [mode, {
      total: rows.length,
      matchExpected: rows.filter((r) => r.matchesExpected).length,
      matchProduction: rows.filter((r) => r.matchesProduction).length,
      falsePositives: rows.filter((r) => !r.expectedContinue && r.shouldContinue).map((r) => r.id),
      falseNegatives: rows.filter((r) => r.expectedContinue && !r.shouldContinue).map((r) => r.id),
      unstable: rows.filter((r) => !r.branchStable).map((r) => r.id),
    }])),
    results: byMode,
  };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ summary: report.summary, wrote: RESULT_PATH }, null, 2));

  // Phase 1 gate: baseline must mostly reproduce production continues/stops.
  if (modes.includes("baseline")) {
    const base = report.summary.baseline;
    const reproduceRate = base.total ? base.matchProduction / base.total : 0;
    console.log(`BASELINE_REPRODUCE_RATE=${reproduceRate.toFixed(2)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
