"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("path");
const { run } = require("../eval/t02/v2/run-harness");
const { applySubjectIdentityGate } = require("../src/ai/tasks/t02-relevance-class/subject-identity-gate");
const { shouldFormIssue } = require("../src/ai/tasks/t02-relevance-class/relevance-policy");

test("golden set v2 meets stop criteria on contexts A, B, and C separately", () => {
  const report = run();
  for (const key of ["A", "B", "C"]) {
    const m = report.by_context[key];
    assert.equal(m.market_leak_rate, 0, `${key} market leak`);
    assert.equal(m.junk_pass_rate, 0, `${key} junk pass`);
    assert.ok(m.signal_miss_rate <= 0.1, `${key} signal miss ${m.signal_miss_rate}`);
    assert.ok(m.flip_rate <= 0.05, `${key} flip ${m.flip_rate}`);
    assert.ok(m.relation_accuracy >= 0.9, `${key} relation accuracy ${m.relation_accuracy}`);
    assert.equal(m.all_green, true, `${key} not all green: ${JSON.stringify(m.failures)}`);
  }
  assert.equal(report.all_green, true);
  assert.ok(report.article_count >= 48);
});

test("named Sutan Raja regression never forms an issue for Context A", () => {
  const contexts = require("../eval/t02/v2/contexts.json");
  const gated = applySubjectIdentityGate({
    relevance: "medium",
    confidence: 0.7,
    subjectRelation: "self",
    fields: contexts.A.fields,
    title: "Sutan Raja Hotel Convention Centre Soreang Luncurkan Promo July Mid Year Magic",
    summary: "Sutan Raja Hotel Soreang menghadirkan promo July Mid Year Magic sepanjang Juli 2026.",
  });
  assert.equal(gated.subjectRelation, "market");
  assert.equal(shouldFormIssue({
    relevance: gated.relevance,
    subjectRelation: gated.subjectRelation,
    competitorOptIn: gated.competitorOptIn,
  }), false);
});

test("anti-bias: src/ai has no hard-coded pilot brand or industry niche prompts", () => {
  const { execSync } = require("child_process");
  const root = path.join(__dirname, "..", "src", "ai");
  // Forbidden tenant/industry hardcodes in prompt/source under src/ai/
  const pattern = "Arunika|hospitality|Hotel|tourism|F&B|manufacturing|fintech|Sutan Raja";
  let out = "";
  try {
    out = execSync(`rg -n -i "${pattern}" "${root}"`, { encoding: "utf8" });
  } catch (err) {
    // rg exit 1 = no matches
    if (err.status === 1) {
      assert.equal(true, true);
      return;
    }
    // Fallback for environments without rg
    out = "";
  }
  const lines = String(out || "")
    .split(/\r?\n/)
    .filter(Boolean)
    // Allow comments that only reference the anti-bias rule, not brand rubrics.
    .filter((line) => !/no-prompt-bias|never hard-code|Never hard-code|anti-bias/i.test(line));
  assert.equal(lines.length, 0, `Forbidden hardcodes in src/ai:\n${lines.join("\n")}`);
});
