"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  shouldFormIssue,
} = require("../src/ai/tasks/t02-relevance-class/relevance-policy");
const {
  applySubjectIdentityGate,
} = require("../src/ai/tasks/t02-relevance-class/subject-identity-gate");
const {
  buildT07Input,
} = require("../src/ai/tasks/t07-issue-analysis/prompt");
const {
  buildPerspectiveReviewInput,
} = require("../src/ai/tasks/t07-issue-analysis/perspective-review");
const { readyManagementIdentity } = require("./support/management-context");

const contexts = [
  {
    name: "Northstar Lodging",
    industry: "Lodging and dining services",
    products: ["Business accommodation", "Managed dining venues"],
    topics: ["Guest demand", "Direct distribution"],
    priorities: ["Grow direct sales"],
    regions: ["Metro One"],
    competitors: [],
  },
  {
    name: "Vector Components",
    industry: "Industrial components",
    products: ["Precision control modules"],
    topics: ["Factory automation", "Component supply"],
    priorities: ["Protect production continuity"],
    regions: ["Industrial Zone Two"],
    competitors: ["Orbit Controls"],
  },
  {
    name: "ClearLedger",
    industry: "Digital financial services",
    products: ["Merchant payments", "Working-capital finance"],
    topics: ["Payment acceptance", "Credit policy"],
    priorities: ["Grow merchant usage"],
    regions: ["Metro Three"],
    competitors: ["Nova Settlement"],
  },
].map((fields) => ({
  ...fields,
  sub_industry: null,
  description: null,
  brands_aliases: [],
  key_people: [],
  customers: [],
  goals: [],
  risks: [],
  dependencies: [],
}));

test("material external market signals continue across industries", () => {
  for (const fields of contexts) {
    const result = applySubjectIdentityGate({
      relevance: "medium",
      confidence: 0.75,
      subjectRelation: "market",
      fields,
      title: `External peer changes pricing in ${fields.regions[0]}`,
      summary: `The move directly affects ${fields.products[0]} demand and ${fields.priorities[0]}.`,
    });
    assert.equal(result.subjectRelation, "market", fields.name);
    assert.equal(result.relevance, "medium", fields.name);
    assert.equal(shouldFormIssue({
      relevance: result.relevance,
      subjectRelation: result.subjectRelation,
    }), true, fields.name);
  }
});

test("subject relation controls framing while unrelated content still stops", () => {
  assert.equal(shouldFormIssue({ relevance: "high", subjectRelation: "self" }), true);
  assert.equal(shouldFormIssue({ relevance: "high", subjectRelation: "competitor" }), true);
  assert.equal(shouldFormIssue({ relevance: "high", subjectRelation: "market" }), true);
  assert.equal(shouldFormIssue({ relevance: "high", subjectRelation: "unrelated" }), false);
  assert.equal(shouldFormIssue({ relevance: "low", subjectRelation: "market" }), false);
});

test("T07 generation and review contracts target dashboard-company management", () => {
  const context = { companyId: "company-1", version: 1, status: "effective", fields: contexts[0], managementIdentity: readyManagementIdentity(contexts[0].name) };
  const evidence = [{
    sourceArticleId: "article-1",
    requestedLocale: "id",
    canonicalUrl: "https://example.test/article-1",
    article: {
      title: "External peer launches aggressive direct-sales discount",
      summary: "The peer is offering a large direct-channel incentive.",
      content: "The campaign targets customers in Metro One.",
      publishedAt: "2026-07-28T00:00:00.000Z",
      updatedAt: null,
    },
  }];
  const issue = { issueId: "issue-1", status: "baru", title: "Peer pricing pressure", oneLiner: "External pricing move" };
  const candidate = {
    what_happened: ["A peer launched a direct-sales discount."],
    why_matters: ["It may change competitive demand for the dashboard company."],
    impacts: [{ text: "Management should compare demand and channel mix.", source_article_ids: ["article-1"] }],
    risks: [],
    watch: [{ text: "Monitor the peer offer and the company's own booking pace.", source_article_ids: ["article-1"] }],
    claims: [{ claim_id: "c1", text: "A peer discount was announced.", source_article_ids: ["article-1"] }],
    subject_relation: "market",
  };
  const generationInput = buildT07Input({
    tenantId: "tenant-1",
    companyId: "company-1",
    issue,
    context,
    evidence,
    outputLanguage: "en",
    subjectRelation: "market",
  });
  const reviewInput = buildPerspectiveReviewInput({
    tenantId: "tenant-1",
    companyId: "company-1",
    context,
    evidence,
    outputLanguage: "en",
    subjectRelation: "market",
    candidate,
  });
  const generationText = generationInput.map((item) => item.content).join("\n");
  const reviewText = reviewInput.map((item) => item.content).join("\n");
  assert.match(generationText, /management \/ leadership of the company|management_identity/i);
  assert.match(generationText, /never write an operations brief for the external company/i);
  assert.match(reviewText, /your company's leadership|leadership persona/i);
  assert.match(reviewText, /invents company|invented company facts/i);
});

