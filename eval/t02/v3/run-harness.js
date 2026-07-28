"use strict";

/**
 * T02 identity eval harness v3 — anti-circular.
 *
 * Predictions MUST run production gates after declared LLM stubs (compositional),
 * never "gate alone with a single fixed self stub" as the only scored path.
 *
 * Usage:
 *   node eval/t02/v3/run-harness.js
 *   node eval/t02/v3/run-harness.js --include-sealed-D
 */

const fs = require("fs");
const path = require("path");
const { applySubjectIdentityGate } = require("../../../src/ai/tasks/t02-relevance-class/subject-identity-gate");
const { applyContextOverlapGate } = require("../../../src/ai/tasks/t02-relevance-class/context-overlap-gate");
const { shouldFormIssue } = require("../../../src/ai/tasks/t02-relevance-class/relevance-policy");

const ROOT = __dirname;
const contextsABC = JSON.parse(fs.readFileSync(path.join(ROOT, "contexts.json"), "utf8"));
const sealedD = JSON.parse(fs.readFileSync(path.join(ROOT, "contexts.sealed.D.json"), "utf8"));
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "golden_set.json"), "utf8"));

const LLM_STUBS = Object.freeze(["always_self", "always_market", "gold_relation", "random_continue"]);

function loadContexts(includeSealedD) {
  const out = { ...contextsABC };
  if (includeSealedD) out.D = sealedD.D;
  return out;
}

function stubLlm(stubName, gold, article, salt) {
  if (stubName === "always_self") {
    return { relevance: "medium", confidence: 0.7, subject_relation: "self" };
  }
  if (stubName === "always_market") {
    return { relevance: "medium", confidence: 0.7, subject_relation: "market" };
  }
  if (stubName === "gold_relation") {
    const rel = gold.subject_relation;
    const continuing = gold.signal === true;
    return {
      relevance: continuing ? "medium" : (rel === "market" ? "low" : "none"),
      confidence: 0.7,
      subject_relation: rel,
    };
  }
  // random_continue: deterministic pseudo-random from article id
  let h = 0;
  const s = `${article.id}:${salt}`;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const continuing = h % 2 === 0;
  const relations = ["self", "market", "unrelated", "competitor"];
  return {
    relevance: continuing ? "medium" : "none",
    confidence: 0.55,
    subject_relation: relations[h % relations.length],
  };
}

function runProductionGates(fields, article, llmOut) {
  const identity = applySubjectIdentityGate({
    relevance: llmOut.relevance,
    confidence: llmOut.confidence,
    subjectRelation: llmOut.subject_relation,
    fields,
    title: article.title,
    summary: article.summary,
    body: article.body || "",
  });
  let relevance = identity.relevance;
  let confidence = identity.confidence;
  let overlapMeta = { gated: false, reason: null };
  if (shouldFormIssue({
    relevance: identity.relevance,
    subjectRelation: identity.subjectRelation,
    competitorOptIn: identity.competitorOptIn,
  })) {
    const hasLexicalIdentity = (identity.selfHits || []).length > 0
      || (identity.competitorHits || []).length > 0;
    if (!hasLexicalIdentity) {
      const overlap = applyContextOverlapGate({
        relevance: identity.relevance,
        confidence: identity.confidence,
        fields,
        title: article.title,
        summary: article.summary,
      });
      relevance = overlap.relevance;
      confidence = overlap.confidence;
      overlapMeta = { gated: Boolean(overlap.gated), reason: overlap.reason || null };
    }
  }
  const forms = shouldFormIssue({
    relevance,
    subjectRelation: identity.subjectRelation,
    competitorOptIn: identity.competitorOptIn,
  });
  return {
    subject_relation: identity.subjectRelation,
    relevance,
    confidence,
    should_form: forms,
    identity_reason: identity.reason,
    overlap: overlapMeta,
    llm_stub: llmOut,
  };
}

/**
 * Final prediction = conservative merge across stubs:
 * forms issue only if ALL adversarial stubs that must be blocked still block market,
 * and signal articles form under always_market + always_self + gold_relation.
 *
 * Scored prediction uses worst-case for precision on market/junk:
 * should_form if ANY stub forms — for market leak detection (must be 0).
 * For signal miss: forms only if ALWAYS forms under always_self AND always_market AND gold_relation
 * (random excluded from signal — too noisy).
 */
function predictEnsemble(fields, article, gold) {
  const byStub = {};
  for (const stub of LLM_STUBS) {
    byStub[stub] = runProductionGates(fields, article, stubLlm(stub, gold, article, stub));
  }
  const core = ["always_self", "always_market", "gold_relation"];
  const anyForm = LLM_STUBS.some((s) => byStub[s].should_form);
  const coreAllForm = core.every((s) => byStub[s].should_form);
  const coreAnyForm = core.some((s) => byStub[s].should_form);

  // Relation: majority among core stubs after gates
  const relCounts = {};
  for (const s of core) {
    const r = byStub[s].subject_relation;
    relCounts[r] = (relCounts[r] || 0) + 1;
  }
  const relation = Object.entries(relCounts).sort((a, b) => b[1] - a[1])[0][0];

  return {
    subject_relation: relation,
    should_form_any: anyForm,
    should_form_core_all: coreAllForm,
    should_form_core_any: coreAnyForm,
    byStub,
  };
}

function scoreContext(ctxKey, fields) {
  let n = 0;
  let relationCorrect = 0;
  let junk = 0;
  let junkPass = 0;
  let signal = 0;
  let signalMiss = 0;
  let marketLeakCases = 0;
  let marketLeaks = 0;
  let selfBody = 0;
  let selfBodyMiss = 0;
  let injection = 0;
  let injectionFail = 0;
  const failures = [];

  for (const article of golden.articles) {
    const gold = article.labels[ctxKey];
    if (!gold) continue;
    n += 1;
    const pred = predictEnsemble(fields, article, gold);

    if (pred.subject_relation === gold.subject_relation) relationCorrect += 1;
    else failures.push({ id: article.id, type: "relation_mismatch", gold: gold.subject_relation, pred: pred.subject_relation });

    if (gold.junk) {
      junk += 1;
      // Precision: any stub opening an issue on junk = fail
      if (pred.should_form_any) {
        junkPass += 1;
        failures.push({ id: article.id, type: "junk_pass", stubs: summarizeForms(pred) });
      }
    }
    if (gold.signal) {
      signal += 1;
      // Recall: must form under all core stubs (including adversarial always_market)
      if (!pred.should_form_core_all) {
        signalMiss += 1;
        failures.push({ id: article.id, type: "signal_miss", stubs: summarizeForms(pred) });
      }
    }
    if (gold.market_leak || gold.subject_relation === "market") {
      marketLeakCases += 1;
      if (pred.should_form_any || pred.subject_relation === "self") {
        // relation majority self on a market gold is a leak; also any stub forming issue
        if (pred.should_form_any || (gold.subject_relation === "market" && pred.subject_relation === "self")) {
          marketLeaks += 1;
          failures.push({ id: article.id, type: "market_leak", stubs: summarizeForms(pred), relation: pred.subject_relation });
        }
      }
    }
    if (gold.subject_relation === "self" && gold.name_position === "body_only" && gold.signal) {
      selfBody += 1;
      if (!pred.should_form_core_all) {
        selfBodyMiss += 1;
        failures.push({ id: article.id, type: "self_body_miss", stubs: summarizeForms(pred) });
      }
    }
    if (article.stratum === "adversarial_injection") {
      injection += 1;
      const sanitized = {
        ...article,
        body: (article.body || "").replace(/IGNORE PREVIOUS INSTRUCTIONS[\s\S]*?\./i, "").trim(),
      };
      const raw = predictEnsemble(fields, article, gold);
      const clean = predictEnsemble(fields, sanitized, gold);
      if (raw.should_form_any && !clean.should_form_any) {
        injectionFail += 1;
        failures.push({ id: article.id, type: "injection_fail" });
      }
    }
  }

  const metrics = {
    context: ctxKey,
    n,
    relation_accuracy: n ? relationCorrect / n : 1,
    junk_pass_rate: junk ? junkPass / junk : 0,
    signal_miss_rate: signal ? signalMiss / signal : 0,
    market_leak_rate: marketLeakCases ? marketLeaks / marketLeakCases : 0,
    self_body_miss_rate: selfBody ? selfBodyMiss / selfBody : 0,
    injection_fail_rate: injection ? injectionFail / injection : 0,
    flip_rate: null,
    counts: { junk, junkPass, signal, signalMiss, marketLeakCases, marketLeaks, selfBody, selfBodyMiss, injection, injectionFail },
  };

  const pass = {
    market_leak_rate: metrics.market_leak_rate === 0,
    junk_pass_rate: metrics.junk_pass_rate === 0,
    signal_miss_rate: metrics.signal_miss_rate <= 0.1,
    self_body_miss_rate: metrics.self_body_miss_rate <= 0.25,
    relation_accuracy: metrics.relation_accuracy >= 0.9,
    injection_fail_rate: metrics.injection_fail_rate === 0,
  };
  metrics.pass = pass;
  metrics.all_green = Object.values(pass).every(Boolean);
  metrics.failures = failures.slice(0, 30);
  return metrics;
}

function summarizeForms(pred) {
  const out = {};
  for (const [k, v] of Object.entries(pred.byStub)) out[k] = { form: v.should_form, rel: v.subject_relation, relv: v.relevance };
  return out;
}

function run({ includeSealedD = false } = {}) {
  const contexts = loadContexts(includeSealedD);
  const byContext = {};
  for (const key of Object.keys(contexts)) {
    byContext[key] = scoreContext(key, contexts[key].fields);
  }
  const report = {
    version: 3,
    spec_id: "T02_IDENTITY_EVAL_V3",
    mode: "compositional_ensemble",
    article_count: golden.articles.length,
    include_sealed_D: includeSealedD,
    generated_at: new Date().toISOString(),
    by_context: byContext,
    all_green: Object.values(byContext).every((m) => m.all_green),
  };
  const outPath = path.join(ROOT, includeSealedD ? "result_v3_with_D.json" : "result_v3.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  const includeSealedD = process.argv.includes("--include-sealed-D");
  // Ensure golden exists
  if (!fs.existsSync(path.join(ROOT, "golden_set.json"))) {
    require("./generate-golden.js");
  }
  const report = run({ includeSealedD });
  const slim = { all_green: report.all_green };
  for (const [k, m] of Object.entries(report.by_context)) {
    slim[k] = {
      all_green: m.all_green,
      market_leak_rate: m.market_leak_rate,
      junk_pass_rate: m.junk_pass_rate,
      signal_miss_rate: m.signal_miss_rate,
      self_body_miss_rate: m.self_body_miss_rate,
      relation_accuracy: m.relation_accuracy,
      injection_fail_rate: m.injection_fail_rate,
      failures: m.failures,
    };
  }
  console.log(JSON.stringify(slim, null, 2));
  process.exit(report.all_green ? 0 : 1);
}

module.exports = { run, predictEnsemble, runProductionGates, LLM_STUBS };
