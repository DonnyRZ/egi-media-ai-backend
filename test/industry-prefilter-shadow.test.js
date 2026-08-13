"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { PipelineStageDispatcher } = require("../src/automation/pipeline-stage-dispatcher");
const { InMemoryPipelineCompanyStore } = require("../src/automation/company-scope");
const { InMemoryPipelineStateStore } = require("../src/pipeline");
const { InMemorySourceSnapshotStore } = require("../src/ingest");
const { InMemoryArticleIndustryDecisionStore } = require("../src/ml/industry-decision.store");
const { createIndustryPrefilterClient } = require("../src/ml/industry-prefilter.client");
const { hasCompanyIdentityHit } = require("../src/ai/tasks/t02-relevance-class/subject-identity-gate");

function companies() {
  return [
    {
      tenantId: "tenant-a",
      companyId: "it-co",
      hasEffectiveContext: true,
      fields: { name: "PT Example Software", industry: "Technology services", brands_aliases: ["ExampleSoft"], competitors: [] },
    },
    {
      tenantId: "tenant-a",
      companyId: "hotel-co",
      hasEffectiveContext: true,
      fields: { name: "PT Example Hospitality", industry: "Hospitality operations", brands_aliases: [], competitors: [] },
    },
    {
      tenantId: "tenant-b",
      companyId: "skipped-context",
      hasEffectiveContext: false,
    },
  ];
}

async function dispatchWith({ scorer, article, mode = "shadow" }) {
  const jobs = [];
  const snapshotStore = new InMemorySourceSnapshotStore({ uuid: () => "snapshot-1" });
  const stored = snapshotStore.upsert({
    sourceArticleId: "article-1",
    locale: "id",
    canonicalUrl: "https://example.test/a",
    article: {
      title: article.title,
      summary: article.summary || "",
      content: article.content || "",
      publishedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  const decisionStore = new InMemoryArticleIndustryDecisionStore({ uuid: () => "decision-1" });
  const dispatcher = new PipelineStageDispatcher({
    companyStore: new InMemoryPipelineCompanyStore({ companies: companies() }),
    pipelineStateStore: new InMemoryPipelineStateStore({ uuid: (() => { let i = 0; return () => `pipeline-${++i}`; })() }),
    pipelineWorker: { enqueueTask: async (job) => { jobs.push(job); return { job: { jobId: `job-${jobs.length}` } }; } },
    logger: { info() {}, warn() {}, error() {} },
    prefilter: { mode, scorer, snapshotStore, decisionStore },
  });
  const result = await dispatcher.dispatch({
    sourceSnapshotId: stored.snapshot.snapshotId,
    sourceArticleId: "article-1",
    locale: "id",
  });
  const audit = await decisionStore.get({ snapshotId: stored.snapshot.snapshotId, industryId: "it", modelVersion: "it-v4" });
  return { result, jobs, audit };
}

test("S38/S40 shadow still fans T02 to every eligible company when v4 rejects", async () => {
  const { result, jobs, audit } = await dispatchWith({
    scorer: { score: async () => ({ ok: true, admit: false, stage1: 0.1, stage2: 0.1, stage1Threshold: 0.29, stage2Threshold: 0.38, modelVersion: "it-v4", scorerMs: 12, error: null }) },
    article: { title: "Kementerian bahas anggaran infrastruktur", summary: "Proyek jalan nasional." },
  });
  assert.equal(result.count, 2);
  assert.deepEqual(jobs.map((job) => job.companyId), ["it-co", "hotel-co"]);
  assert.ok(jobs.every((job) => job.taskId === "T02"));
  assert.equal(audit.admit, false);
  assert.deepEqual(audit.payload.would_skip_company_ids, ["it-co"]);
  assert.deepEqual(audit.payload.it_mapped_company_ids, ["it-co"]);
  assert.equal(audit.payload.identity_bypass_company_ids.length, 0);
});

test("shadow identity hit is would_bypass, not would_skip, and T02 still runs", async () => {
  const { result, jobs, audit } = await dispatchWith({
    scorer: { score: async () => ({ ok: true, admit: false, stage1: 0.05, stage2: 0.05, stage1Threshold: 0.29, stage2Threshold: 0.38, modelVersion: "it-v4", scorerMs: 9, error: null }) },
    article: { title: "ExampleSoft membuka kantor baru di Jakarta", summary: "Ekspansi operasional." },
  });
  assert.equal(result.count, 2);
  assert.deepEqual(jobs.map((job) => job.companyId), ["it-co", "hotel-co"]);
  assert.deepEqual(audit.payload.identity_bypass_company_ids, ["it-co"]);
  assert.deepEqual(audit.payload.would_skip_company_ids, []);
});

test("scorer down fail-opens T02 and records scorer_error", async () => {
  const { result, jobs, audit } = await dispatchWith({
    scorer: { score: async () => ({ ok: false, admit: null, stage1: null, stage2: null, stage1Threshold: null, stage2Threshold: null, modelVersion: "it-v4", scorerMs: 8000, error: "scorer_unreachable" }) },
    article: { title: "Berita umum", summary: "Tidak terkait." },
  });
  assert.equal(result.count, 2);
  assert.equal(jobs.length, 2);
  assert.equal(audit.admit, null);
  assert.equal(audit.payload.scorer_error, "scorer_unreachable");
  assert.deepEqual(audit.payload.would_skip_company_ids, []);
});

test("HTTP client fail-open when fetch rejects", async () => {
  const client = createIndustryPrefilterClient({
    url: "http://127.0.0.1:9",
    timeoutMs: 50,
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
  });
  const result = await client.score({ title: "x", summary: "y" });
  assert.equal(result.ok, false);
  assert.equal(result.admit, null);
  assert.match(result.error, /ECONNREFUSED/);
});

test("hasCompanyIdentityHit is true for alias in title", () => {
  assert.equal(hasCompanyIdentityHit({
    fields: { name: "PT Example Software", brands_aliases: ["ExampleSoft"], competitors: [] },
    title: "ExampleSoft membuka kantor baru",
    summary: "",
  }), true);
  assert.equal(hasCompanyIdentityHit({
    fields: { name: "PT Example Software", brands_aliases: ["ExampleSoft"], competitors: [] },
    title: "Kementerian bahas anggaran",
    summary: "",
  }), false);
});

test("mode off does not persist an industry decision", async () => {
  const { result, jobs, audit } = await dispatchWith({
    mode: "off",
    scorer: { score: async () => { throw new Error("should not score"); } },
    article: { title: "Anything", summary: "" },
  });
  assert.equal(result.count, 2);
  assert.equal(jobs.length, 2);
  assert.equal(audit, null);
  assert.equal(result.prefilter.mode, "off");
});
