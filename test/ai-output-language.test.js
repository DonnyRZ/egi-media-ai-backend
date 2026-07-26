const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AI_OUTPUT_LANGUAGE_RULE,
  PROSE_LANGUAGE_TASKS,
  LANGUAGE_NA_TASKS,
  resolveAiOutputLanguage,
  resolveDraftLanguage,
  applyOutputLanguage,
  outputLanguageContractRule,
  DEFAULT_LANGUAGE,
} = require("../src/language/ai-output-language");

const { buildT01Input } = require("../src/ai/tasks/t01-company-context-draft/prompt");
const { buildT03Input } = require("../src/ai/tasks/t03-relevance-rationale/prompt");
const { buildT05Input } = require("../src/ai/tasks/t05-issue-title/prompt");
const { buildT06Input } = require("../src/ai/tasks/t06-issue-oneliner/prompt");
const { buildT07Input } = require("../src/ai/tasks/t07-issue-analysis/prompt");
const { buildT10Input } = require("../src/ai/tasks/t10-priority-reason/prompt");
const { buildT12Input } = require("../src/ai/tasks/t12-direct-blurbs/prompt");
const { buildT13Input } = require("../src/ai/tasks/t13-report-narrative/prompt");
const { buildT14Input } = require("../src/ai/tasks/t14-constrained-rewrite/prompt");

const SOURCE_DIFFERS_PHRASE = "source material may be in a different language";

const articleStub = {
  sourceArticleId: "art-1",
  requestedLocale: "id",
  contentLocale: "en",
  canonicalUrl: "https://example.com/a",
  article: {
    title: "Title",
    summary: "Summary",
    content: "Body",
    publishedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
};

function messagesText(messages) {
  return messages.map((message) => message.content).join("\n");
}

function assertProseLanguageContract(messages) {
  const text = messagesText(messages);
  assert.match(text, /"output_language"/);
  assert.match(text, /output_language/);
  assert.match(text, new RegExp(SOURCE_DIFFERS_PHRASE, "i"));
}

test("resolveAiOutputLanguage defaults unsupported values to id", () => {
  assert.equal(resolveAiOutputLanguage(null), "id");
  assert.equal(resolveAiOutputLanguage(undefined), "id");
  assert.equal(resolveAiOutputLanguage("uz"), "id");
  assert.equal(resolveAiOutputLanguage("en"), "en");
  assert.equal(DEFAULT_LANGUAGE, "id");
});

test("resolveDraftLanguage prefers explicit id|en and falls back to company locale", () => {
  assert.equal(resolveDraftLanguage({ companyLocale: null }), "id");
  assert.equal(resolveDraftLanguage({ companyLocale: "en" }), "en");
  assert.equal(resolveDraftLanguage({ explicitLanguage: "en", companyLocale: "id" }), "en");
  assert.equal(resolveDraftLanguage({ explicitLanguage: "id", companyLocale: "en" }), "id");
  assert.throws(
    () => resolveDraftLanguage({ explicitLanguage: "uz", companyLocale: "en" }),
    { code: "VALIDATION_ERROR", statusCode: 400 },
  );
});

test("applyOutputLanguage sets output_language on trusted context", () => {
  assert.deepEqual(applyOutputLanguage({ company_id: "c1" }, "en"), {
    company_id: "c1",
    output_language: "en",
  });
});

test("outputLanguageContractRule covers output language and differing source language", () => {
  const rule = outputLanguageContractRule();
  assert.equal(rule, AI_OUTPUT_LANGUAGE_RULE);
  assert.match(rule, /output_language/i);
  assert.match(rule, new RegExp(SOURCE_DIFFERS_PHRASE, "i"));
});

test("inventories cover prose and N/A tasks", () => {
  assert.deepEqual([...PROSE_LANGUAGE_TASKS], ["T01", "T03", "T05", "T06", "T07", "T10", "T12", "T13", "T14"]);
  assert.deepEqual([...LANGUAGE_NA_TASKS], ["T02", "T04", "T08", "T09"]);
});

test("T01 buildT01Input embeds output_language and language rule", () => {
  const messages = buildT01Input({
    companyId: "c1",
    extractionLanguage: "id",
    allowedFields: ["name"],
    limits: { maxSources: 1, maxCharsPerSource: 100, maxTotalChars: 100 },
    sources: [{ sourceLocator: "src-1", sourceType: "paste", text: "PT Example" }],
  });
  assertProseLanguageContract(messages);
});

test("T03 buildT03Input embeds output_language and language rule", () => {
  const messages = buildT03Input({
    companyId: "c1",
    context: { version: 1, fields: { name: "Acme" } },
    decision: { decisionId: "d1", relevance: "high", confidence: 0.9 },
    source: articleStub,
  });
  assertProseLanguageContract(messages);
});

test("T05 buildT05Input embeds output_language and language rule", () => {
  const messages = buildT05Input({
    tenantId: "t1",
    companyId: "c1",
    issue: { issueId: "i1", status: "active" },
    development: { developmentId: "dev-1", developmentType: "new", observedAt: "2026-07-01T00:00:00.000Z" },
    matchDecision: { matchDecisionId: "m1", decision: "new", reasonCode: "new_event" },
    source: articleStub,
  });
  assertProseLanguageContract(messages);
});

test("T06 buildT06Input embeds output_language and language rule", () => {
  const messages = buildT06Input({
    tenantId: "t1",
    companyId: "c1",
    issue: { issueId: "i1", status: "active", title: "Title" },
    development: { developmentId: "dev-1", developmentType: "new", observedAt: "2026-07-01T00:00:00.000Z" },
    matchDecision: { matchDecisionId: "m1", decision: "new", reasonCode: "new_event" },
    source: articleStub,
  });
  assertProseLanguageContract(messages);
});

test("T07 buildT07Input embeds output_language and language rule", () => {
  const messages = buildT07Input({
    tenantId: "t1",
    companyId: "c1",
    issue: { issueId: "i1", status: "active", title: "Title", oneLiner: "One liner" },
    context: { version: 1, fields: { name: "Acme" } },
    evidence: [articleStub],
  });
  assertProseLanguageContract(messages);
});

test("T10 buildT10Input embeds output_language and language rule", () => {
  const messages = buildT10Input({
    tenantId: "t1",
    companyId: "c1",
    issue: { issueId: "i1", status: "active" },
    analysis: {
      analysisId: "a1",
      contextVersion: 1,
      validatedAt: "2026-07-01T00:00:00.000Z",
      analysis: {
        what_happened: "x",
        why_matters: "y",
        impacts: [],
        risks: [],
        watch: [],
      },
    },
    context: { version: 1, fields: { name: "Acme" } },
    priorityDecision: { priorityDecisionId: "p1", analysisId: "a1", priority: "tinggi" },
    labeledClaims: [{ claimId: "cl-1", text: "claim", label: "fact" }],
  });
  assertProseLanguageContract(messages);
});

test("T12 buildT12Input embeds output_language and language rule", () => {
  const messages = buildT12Input({
    tenantId: "t1",
    companyId: "c1",
    issue: { issueId: "i1", title: "Title", oneLiner: "One liner" },
    development: { developmentId: "dev-1", developmentType: "new", observedAt: "2026-07-01T00:00:00.000Z" },
    detailUrl: "https://app.example/issues/i1",
    priority: "tinggi",
    sourceClaims: [{ claimId: "cl-1", text: "claim" }],
  });
  assertProseLanguageContract(messages);
});

test("T13 buildT13Input embeds output_language and language rule", () => {
  const messages = buildT13Input({
    tenantId: "t1",
    companyId: "c1",
    report: {
      reportId: "r1",
      reportType: "weekly",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-07",
      timezone: "Asia/Jakarta",
      contextVersion: 1,
      reviewStatus: "draft",
      metrics: { issue_count: 1 },
      selectedIssuePack: [{
        reportItemId: "ri-1",
        issueId: "i1",
        analysisId: "a1",
        priority: "tinggi",
        title: "Title",
        oneLiner: "One liner",
        analysis: { whatHappened: "x", whyMatters: "y" },
        claims: [{ claimId: "cl-1", text: "claim", sourceArticleIds: ["art-1"] }],
        citations: [{ sourceArticleId: "art-1", canonicalUrl: "https://example.com/a" }],
      }],
    },
  });
  assertProseLanguageContract(messages);
});

test("T14 buildT14Input embeds output_language and language rule", () => {
  const messages = buildT14Input({
    tenantId: "t1",
    companyId: "c1",
    report: { reportId: "r1" },
    narrative: { reportNarrativeId: "n1", version: 1 },
    span: { spanId: "s1", text: "old text", sourceClaimIds: ["cl-1"] },
    humanInstruction: "Make shorter",
    sourceClaims: [{ claimId: "cl-1", text: "claim" }],
  });
  assertProseLanguageContract(messages);
});
