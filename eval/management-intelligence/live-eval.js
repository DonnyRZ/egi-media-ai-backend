"use strict";

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
const { buildT07Input } = require("../../src/ai/tasks/t07-issue-analysis/prompt");
const { T07_OUTPUT_SCHEMA } = require("../../src/ai/tasks/t07-issue-analysis/schema");
const { validateT07Output } = require("../../src/ai/tasks/t07-issue-analysis/output-validator");
const {
  T07_PERSPECTIVE_REVIEW_SCHEMA,
  buildPerspectiveReviewInput,
  validatePerspectiveReview,
} = require("../../src/ai/tasks/t07-issue-analysis/perspective-review");

const AUDIT_SCHEMA = {
  name: "management_intelligence_audit_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "pass",
      "external_ops_framing",
      "invented_company_facts",
      "missing_company_implication",
      "reasons",
    ],
    properties: {
      pass: { type: "boolean" },
      external_ops_framing: { type: "boolean" },
      invented_company_facts: { type: "boolean" },
      missing_company_implication: { type: "boolean" },
      reasons: {
        type: "array",
        maxItems: 6,
        items: { type: "string", minLength: 1, maxLength: 240 },
      },
    },
  },
};

const baseFields = {
  sub_industry: null,
  description: null,
  customers: [],
  regions: [],
  competitors: [],
  brands_aliases: [],
  key_people: [],
  priorities: [],
  goals: [],
  risks: [],
  topics: [],
  dependencies: [],
};

const contexts = {
  A: {
    ...baseFields,
    name: "Northstar Lodging Collective",
    industry: "Lodging, dining, and guest services",
    products: ["Business accommodation", "Managed dining venues"],
    regions: ["Metro One", "Island Two"],
    priorities: ["Grow direct sales", "Protect guest demand"],
    topics: ["Guest experience", "Destination demand"],
  },
  B: {
    ...baseFields,
    name: "Vector Components",
    industry: "Industrial components manufacturing",
    products: ["Precision control modules", "Automated packing lines"],
    regions: ["Industrial Zone Three"],
    competitors: ["Orbit Controls"],
    priorities: ["Protect production continuity", "Control input costs"],
    topics: ["Factory automation", "Component supply"],
  },
  C: {
    ...baseFields,
    name: "ClearLedger",
    industry: "Digital financial services",
    products: ["Merchant payments", "Working-capital finance"],
    regions: ["Metro Four"],
    competitors: ["Nova Settlement"],
    priorities: ["Grow merchant usage", "Maintain credit quality"],
    topics: ["Payment acceptance", "Credit regulation"],
  },
};

const allScenarios = [
  scenario("A-peer", "A", true, "market",
    "Rival lodging operator launches 25% direct-channel discount in Metro One",
    "The offer targets business and leisure stays for the next six weeks.",
    "The operator is not named in Northstar's competitor list. It promotes direct sales and discounted room packages."),
  scenario("A-sutan-regression", "A", true, "market",
    "Sutan Raja Hotel Convention Centre Soreang launches July Mid Year Magic promotion",
    "The peer property offers room discounts and a direct-booking package throughout July.",
    "The campaign targets lodging demand with explicit promotional pricing. Sutan Raja is not listed in the company context."),
  scenario("A-dining-peer", "A", true, "market",
    "Local dining peer launches a weekend heritage market",
    "The restaurant uses a themed event and merchant collaboration to attract weekend customers.",
    "The campaign is a concrete customer-acquisition move in managed dining and is not about Northstar."),
  scenario("A-regulation", "A", true, "market",
    "Island Two proposes a new visitor levy starting next year",
    "The levy would increase the cost of every overnight visitor.",
    "The proposal applies destination-wide and may affect travel demand. It does not name any lodging operator."),
  scenario("A-generic-ai", "A", false, "market",
    "Artificial intelligence is changing how people work",
    "A commentary says companies can use AI for reports, customer service, and decisions.",
    "It reports no concrete adoption, rule, competitor move, cost, demand metric, or event tied to lodging, dining, Metro One, or Island Two."),
  scenario("A-broad-market", "A", false, "unrelated",
    "Stock index moves after central bank governor resigns",
    "A short market video observes daily index movement.",
    "It gives no concrete travel, lodging, dining, financing, demand, or company-context impact."),
  scenario("A-local-crime", "A", false, "market",
    "Motorcycle dispute triggers a deadly neighborhood clash in Metro One",
    "Police report casualties and damaged vehicles on one neighborhood street.",
    "The article states no broad effect on visitor demand, hotel access, regulation, operations, or any property named in company context."),
  scenario("A-local-roadwork", "A", false, "market",
    "Road resurfacing causes congestion on one street in Metro One",
    "One traffic lane is temporarily unavailable during local road repairs.",
    "The article states no effect on a named property or dependency and no citywide change to travel demand, access, cost, or operations."),
  scenario("A-customer-coincidence", "A", false, "market",
    "Private running event for foreign residents draws criticism in Island Two",
    "A community event allegedly restricted registration by nationality.",
    "The dispute does not change tourism rules, visitor access, demand, hotel operations, or any company-context property or dependency."),
  scenario("A-advocacy-only", "A", false, "market",
    "Business association asks government to study early workforce mitigation",
    "The association requests discussion to prevent possible future layoffs.",
    "No layoffs, enacted policy, labor-cost change, staffing rule, or measured effect on the supplied company context is reported."),
  scenario("A-unrelated-vendor-metric", "A", false, "market",
    "Home water-heater vendor says electric units make up 65 percent of its sales",
    "The appliance seller reports its own product mix and promotes energy efficiency.",
    "It states no hotel operating standard, procurement dependency, utility-cost change, regulation, or adoption benchmark for the supplied company context."),
  scenario("A-broad-sustainability", "A", false, "market",
    "Minister reports long-term national mangrove loss and urges restoration",
    "A national environmental programme discusses restoration in unspecified locations.",
    "It reports no change affecting a company operating region, property, supplier, rule, cost, demand condition, or named dependency."),
  scenario("A-weak", "A", false, "market",
    "A restaurant changes the colour of its staff uniforms",
    "The change has no disclosed effect on demand, pricing, regulation, supply, or guest behaviour.",
    "The article is a short lifestyle feature about visual design."),
  scenario("A-unrelated", "A", false, "unrelated",
    "Pop singer releases a new album",
    "Fans discuss the artist's latest songs.",
    "The story contains no business or company-context development."),

  scenario("B-competitor", "B", true, "competitor",
    "Orbit Controls cuts prices for precision control modules",
    "The listed competitor offers a 15% discount to regional distributors.",
    "The move could change component pricing and customer procurement decisions in Industrial Zone Three."),
  scenario("B-market", "B", true, "market",
    "New import duty raises the cost of industrial sensors",
    "The rule applies to imported inputs used by component manufacturers.",
    "No company is named, but the duty affects production inputs and supply continuity."),
  scenario("B-generic-advice", "B", false, "market",
    "Artificial intelligence can transform modern businesses",
    "A general explainer lists automation and productivity benefits.",
    "It contains no factory deployment, component supply event, regulation, competitor action, measured cost, or Industrial Zone Three development."),
  scenario("B-weak", "B", false, "market",
    "Factory lobby repaints its reception area",
    "The refurbishment has no stated effect on output, supply, customers, or cost.",
    "The story focuses only on interior decoration."),
  scenario("B-unrelated", "B", false, "unrelated",
    "National football team wins friendly match",
    "A late goal secured the result.",
    "The story is only about sport."),

  scenario("C-competitor", "C", true, "competitor",
    "Nova Settlement doubles cashback for merchant payments",
    "The listed competitor is subsidising payment acceptance for three months.",
    "The campaign targets merchants in Metro Four and may change merchant usage."),
  scenario("C-regulation", "C", true, "market",
    "Regulator tightens underwriting rules for working-capital finance",
    "New affordability checks apply to digital lenders.",
    "The rule may affect approval rates, credit quality, and compliance cost across the market."),
  scenario("C-generic-marketing", "C", false, "market",
    "Experiential marketing can build customer loyalty",
    "A general strategy article recommends memorable brand experiences.",
    "It reports no merchant payment campaign, competitor move, credit rule, measured demand change, or Metro Four event."),
  scenario("C-weak", "C", false, "market",
    "Payment company redesigns its office cafeteria menu",
    "The change has no stated impact on merchants, payments, lending, or regulation.",
    "The story is an employee lifestyle feature."),
  scenario("C-unrelated", "C", false, "unrelated",
    "Actor announces a new television series",
    "The entertainment programme premieres next month.",
    "No financial-services development is present."),
];

const requestedIds = new Set((process.env.AUDIT_SCENARIO_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));
const scenarios = requestedIds.size > 0
  ? allScenarios.filter((item) => requestedIds.has(item.id))
  : allScenarios;

function scenario(id, contextKey, expectedContinue, expectedRelation, title, summary, content) {
  return { id, contextKey, expectedContinue, expectedRelation, title, summary, content };
}

function sourceFor(item) {
  return {
    sourceArticleId: `eval:${item.id}`,
    requestedLocale: "en",
    contentLocale: "en",
    canonicalUrl: `https://eval.invalid/${item.id}`,
    article: {
      title: item.title,
      summary: item.summary,
      content: item.content,
      publishedAt: "2026-07-28T00:00:00.000Z",
      updatedAt: null,
    },
  };
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const models = {
    nanoModel: process.env.OPENAI_NANO_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
    miniModel: process.env.OPENAI_MINI_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
  };
  const client = createOpenAiClient({ apiKey, timeoutMs: 180000 });
  const kernel = new AiTaskKernel({
    openaiClient: client,
    openaiConfig: models,
    defaultTimeoutMs: 180000,
  });

  const results = [];
  for (const item of scenarios) {
    const fields = contexts[item.contextKey];
    const context = {
      companyId: `eval-${item.contextKey}`,
      version: 1,
      status: "effective",
      fields,
    };
    const source = sourceFor(item);
    const t02Input = buildT02Input({
      companyId: context.companyId,
      context,
      source,
      // Match production: body is for identity gate only, not the model.
      options: { includeBodySnippet: false, useRubric: true },
    });
    const passes = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await kernel.execute({
        model: "mini",
        input: t02Input,
        outputSchema: T02_OUTPUT_SCHEMA,
        requestId: randomUUID(),
      });
      passes.push(validateT02Output(result.data));
    }
    const merged = mergeRelevanceOutputs(...passes);
    const identity = applySubjectIdentityGate({
      relevance: merged.relevance,
      confidence: merged.confidence,
      subjectRelation: merged.subject_relation,
      fields,
      title: item.title,
      summary: item.summary,
      body: item.content,
    });
    const materiality = applyMarketMaterialityGate({
      relevance: identity.relevance,
      confidence: identity.confidence,
      subjectRelation: identity.subjectRelation,
      fields,
      title: item.title,
      summary: item.summary,
    });
    const shouldContinue = shouldFormIssue({
      relevance: materiality.relevance,
      subjectRelation: identity.subjectRelation,
    });
    const relationStable = new Set(passes.map((pass) => pass.subject_relation)).size === 1;
    const branchStable = new Set(passes.map((pass) => shouldFormIssue({
      relevance: pass.relevance,
      subjectRelation: pass.subject_relation,
    }))).size === 1;
    const operationallyStable = branchStable && (!item.expectedContinue || relationStable);

    const record = {
      id: item.id,
      contextKey: item.contextKey,
      expectedContinue: item.expectedContinue,
      expectedRelation: item.expectedRelation,
      t02: {
        passes,
        merged,
        identity,
        shouldContinue,
        relationStable,
        branchStable,
        operationallyStable,
        pass: shouldContinue === item.expectedContinue
          && (!item.expectedContinue || identity.subjectRelation === item.expectedRelation)
          && operationallyStable,
      },
      t07: null,
    };

    if (shouldContinue) {
      const evidence = [source];
      const issue = {
        issueId: `issue:${item.id}`,
        status: "baru",
        title: item.title,
        oneLiner: item.summary,
      };
      const allowedArticleIds = new Set([source.sourceArticleId]);
      const generation = await kernel.execute({
        model: "mini",
        input: buildT07Input({
          tenantId: "eval-tenant",
          companyId: context.companyId,
          issue,
          context,
          evidence,
          outputLanguage: "en",
          subjectRelation: identity.subjectRelation,
        }),
        outputSchema: T07_OUTPUT_SCHEMA,
        requestId: randomUUID(),
      });
      const candidate = validateT07Output(generation.data, {
        allowedArticleIds,
        expectedSubjectRelation: identity.subjectRelation,
      });
      const reviewResult = await kernel.execute({
        model: "mini",
        input: buildPerspectiveReviewInput({
          tenantId: "eval-tenant",
          companyId: context.companyId,
          context,
          evidence,
          outputLanguage: "en",
          subjectRelation: identity.subjectRelation,
          candidate,
        }),
        outputSchema: T07_PERSPECTIVE_REVIEW_SCHEMA,
        requestId: randomUUID(),
      });
      const review = validatePerspectiveReview(reviewResult.data, {
        allowedArticleIds,
        expectedSubjectRelation: identity.subjectRelation,
      });
      const finalAnalysis = review.verdict === "corrected"
        ? review.corrected_analysis
        : candidate;
      const audit = await kernel.execute({
        model: "mini",
        input: buildIndependentAuditInput({ fields, item, finalAnalysis }),
        outputSchema: AUDIT_SCHEMA,
        requestId: randomUUID(),
      });
      record.t07 = {
        candidate,
        review,
        finalAnalysis,
        independentAudit: audit.data,
        pass: audit.data.pass === true
          && audit.data.external_ops_framing === false
          && audit.data.invented_company_facts === false
          && audit.data.missing_company_implication === false,
      };
    }
    results.push(record);
    console.log(JSON.stringify({
      id: record.id,
      t02: record.t02.pass,
      continue: shouldContinue,
      relation: identity.subjectRelation,
      t07: record.t07?.pass ?? null,
      review: record.t07?.review?.verdict ?? null,
    }));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    models,
    total: results.length,
    t02Pass: results.filter((item) => item.t02.pass).length,
    t02Stable: results.filter((item) => item.t02.operationallyStable).length,
    t07Total: results.filter((item) => item.t07).length,
    t07Pass: results.filter((item) => item.t07?.pass).length,
    allGreen: results.every((item) => item.t02.pass && (!item.t07 || item.t07.pass)),
    results,
  };
  fs.writeFileSync(
    path.join(__dirname, "live-result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({
    allGreen: report.allGreen,
    total: report.total,
    t02Pass: report.t02Pass,
    t02Stable: report.t02Stable,
    t07Total: report.t07Total,
    t07Pass: report.t07Pass,
  }, null, 2));
  process.exit(report.allGreen ? 0 : 1);
}

function buildIndependentAuditInput({ fields, item, finalAnalysis }) {
  return [
    {
      role: "system",
      content: [
        "You independently audit management intelligence.",
        "The analysis audience must be management of the dashboard company in COMPANY_CONTEXT.",
        "For peer, competitor, or market articles, external facts may describe the article subject, but implications, risks, and watch items must address the dashboard company.",
        "external_ops_framing=true ONLY when the analysis gives internal instructions to the external article subject instead of the dashboard company. Mentioning or monitoring the external entity is not external-ops framing.",
        "invented_company_facts=true ONLY when the analysis states a dashboard-company fact absent from COMPANY_CONTEXT as certain.",
        "missing_company_implication=true ONLY when implications for the dashboard company are absent.",
        "pass MUST equal NOT(external_ops_framing OR invented_company_facts OR missing_company_implication). Keep these booleans logically consistent.",
        "Fail if it gives internal instructions to the external entity, merely paraphrases with no company implication, or invents dashboard-company facts not in context.",
        "Return only the schema.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `<COMPANY_CONTEXT>${JSON.stringify(fields)}</COMPANY_CONTEXT>`,
        `<ARTICLE>${JSON.stringify({ title: item.title, summary: item.summary, content: item.content })}</ARTICLE>`,
        `<ANALYSIS>${JSON.stringify(finalAnalysis)}</ANALYSIS>`,
      ].join("\n"),
    },
  ];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

