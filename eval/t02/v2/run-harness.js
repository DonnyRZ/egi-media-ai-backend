"use strict";

/**
 * T02 identity-relevance eval harness v2.
 * Scores subject_relation + issue-formation policy per context A/B/C using the
 * deterministic subject-identity gate (same code path as production post-LLM).
 *
 * Stop criteria (per context, not averaged):
 * - market leak-rate = 0%
 * - junk pass = 0%
 * - signal miss ≤ 10%
 * - flip ≤ 5% (relation mismatch vs gold where both labeled)
 * - relation accuracy ≥ 90%
 */

const fs = require("fs");
const path = require("path");
const { applySubjectIdentityGate } = require("../../../src/ai/tasks/t02-relevance-class/subject-identity-gate");
const { shouldFormIssue } = require("../../../src/ai/tasks/t02-relevance-class/relevance-policy");

const ROOT = __dirname;
const contexts = JSON.parse(fs.readFileSync(path.join(ROOT, "contexts.json"), "utf8"));
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "golden_set.json"), "utf8"));

function predict(fields, article) {
  // Simulate a permissive LLM that often claims self on industry overlap — identity gate must correct.
  const identity = applySubjectIdentityGate({
    relevance: "medium",
    confidence: 0.7,
    subjectRelation: "self",
    fields,
    title: article.title,
    summary: article.summary,
  });
  const forms = shouldFormIssue({
    relevance: identity.relevance,
    subjectRelation: identity.subjectRelation,
    competitorOptIn: identity.competitorOptIn,
  });
  return {
    subject_relation: identity.subjectRelation,
    relevance: identity.relevance,
    should_form: forms,
  };
}

function scoreContext(ctxKey) {
  const fields = contexts[ctxKey].fields;
  let n = 0;
  let relationCorrect = 0;
  let junk = 0;
  let junkPass = 0;
  let signal = 0;
  let signalMiss = 0;
  let marketLeakCases = 0;
  let marketLeaks = 0;
  let flips = 0;
  const failures = [];

  for (const article of golden.articles) {
    const gold = article.labels[ctxKey];
    if (!gold) continue;
    n += 1;
    const pred = predict(fields, article);
    if (pred.subject_relation === gold.subject_relation) relationCorrect += 1;
    else {
      flips += 1;
      failures.push({ id: article.id, type: "relation_mismatch", gold: gold.subject_relation, pred: pred.subject_relation });
    }

    if (gold.junk) {
      junk += 1;
      if (pred.should_form) {
        junkPass += 1;
        failures.push({ id: article.id, type: "junk_pass", gold, pred });
      }
    }
    if (gold.signal) {
      signal += 1;
      if (!pred.should_form) {
        signalMiss += 1;
        failures.push({ id: article.id, type: "signal_miss", gold, pred });
      }
    }
    if (gold.market_leak || gold.subject_relation === "market") {
      marketLeakCases += 1;
      if (pred.should_form || pred.subject_relation === "self") {
        marketLeaks += 1;
        failures.push({ id: article.id, type: "market_leak", gold, pred });
      }
    }
  }

  const metrics = {
    context: ctxKey,
    n,
    relation_accuracy: n ? relationCorrect / n : 0,
    junk_pass_rate: junk ? junkPass / junk : 0,
    signal_miss_rate: signal ? signalMiss / signal : 0,
    flip_rate: n ? flips / n : 0,
    market_leak_rate: marketLeakCases ? marketLeaks / marketLeakCases : 0,
    junk,
    junk_pass: junkPass,
    signal,
    signal_miss: signalMiss,
    market_leak_cases: marketLeakCases,
    market_leaks: marketLeaks,
  };

  const pass = {
    market_leak_rate: metrics.market_leak_rate === 0,
    junk_pass_rate: metrics.junk_pass_rate === 0,
    signal_miss_rate: metrics.signal_miss_rate <= 0.1,
    flip_rate: metrics.flip_rate <= 0.05,
    relation_accuracy: metrics.relation_accuracy >= 0.9,
  };
  metrics.pass = pass;
  metrics.all_green = Object.values(pass).every(Boolean);
  metrics.failures = failures.slice(0, 20);
  return metrics;
}

function run() {
  const byContext = {};
  for (const key of ["A", "B", "C"]) byContext[key] = scoreContext(key);
  const report = {
    version: 2,
    article_count: golden.articles.length,
    generated_at: new Date().toISOString(),
    by_context: byContext,
    all_green: Object.values(byContext).every((m) => m.all_green),
  };
  const outPath = path.join(ROOT, "result_v2.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  const report = run();
  console.log(JSON.stringify({
    all_green: report.all_green,
    A: report.by_context.A,
    B: report.by_context.B,
    C: report.by_context.C,
  }, null, 2));
  process.exit(report.all_green ? 0 : 1);
}

module.exports = { run, predict, scoreContext };
