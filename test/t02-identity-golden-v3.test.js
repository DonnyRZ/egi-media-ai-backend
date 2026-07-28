"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("path");
const fs = require("fs");
const { run } = require("../eval/t02/v3/run-harness");

test("v3 compositional harness is green on A/B/C", () => {
  const report = run({ includeSealedD: false });
  assert.equal(report.all_green, true, JSON.stringify(report.by_context, null, 2));
});

test("v3 compositional harness is green including sealed context D", () => {
  const report = run({ includeSealedD: true });
  assert.equal(report.all_green, true, JSON.stringify(report.by_context, null, 2));
});

test("named Sutan Raja regression never forms an issue for context A", () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "../eval/t02/v3/golden_set.json"), "utf8"));
  const article = golden.articles.find((a) => a.id === "a-market-sutan-raja");
  assert.ok(article);
  const { predictEnsemble } = require("../eval/t02/v3/run-harness");
  const contexts = JSON.parse(fs.readFileSync(path.join(__dirname, "../eval/t02/v3/contexts.json"), "utf8"));
  const pred = predictEnsemble(contexts.A.fields, article, article.labels.A);
  assert.equal(pred.should_form_any, false);
  assert.notEqual(pred.subject_relation, "self");
});

test("anti-bias: src/ai has no hard-coded tenant/industry brand strings", () => {
  const aiRoot = path.join(__dirname, "../src/ai");
  const forbidden = [
    /arunika/i,
    /sutan\s*raja/i,
    /nexora/i,
    /aurumpay/i,
    /hospitality group/i,
  ];
  const hits = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith(".js")) {
        const text = fs.readFileSync(full, "utf8");
        for (const re of forbidden) {
          if (re.test(text)) hits.push(`${full} ~ ${re}`);
        }
      }
    }
  }
  walk(aiRoot);
  assert.deepEqual(hits, [], hits.join("\n"));
});
