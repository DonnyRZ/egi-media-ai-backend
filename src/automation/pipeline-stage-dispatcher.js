const { isEvalTenantId } = require("./worker-tenant-policy");
const { mapIndustry } = require("../ml/industry-catalog-map");
const { hasCompanyIdentityHit } = require("../ai/tasks/t02-relevance-class/subject-identity-gate");

class PipelineStageDispatcher {
  constructor({ companyStore, pipelineStateStore, pipelineWorker, logger = null, prefilter = null } = {}) {
    if (!companyStore?.listEligible || !pipelineStateStore?.create || !pipelineWorker?.enqueueTask) {
      throw new TypeError("Pipeline stage dispatcher requires company, state, and worker services");
    }
    Object.assign(this, {
      companyStore,
      pipelineStateStore,
      pipelineWorker,
      logger: logger || { info() {}, warn() {}, error() {} },
      prefilter: prefilter || { mode: "off" },
    });
  }

  async dispatch({ sourceSnapshotId, sourceArticleId, source_snapshot_id, source_article_id, locale, traceId = null, trace_id = null }) {
    sourceSnapshotId = sourceSnapshotId || source_snapshot_id;
    sourceArticleId = sourceArticleId || source_article_id;
    traceId = traceId || trace_id;
    const allowEval = process.env.AI_ALLOW_EVAL_TENANTS === "true";
    const companies = (await this.companyStore.listEligible())
      .filter((scope) => allowEval || !isEvalTenantId(scope.tenantId));
    const audit = await this._shadowIndustryPrefilter({ sourceSnapshotId, sourceArticleId, locale, companies });
    const pipelines = [];
    for (const scope of companies) {
      const state = await this.pipelineStateStore.create({ ...scope, currentTaskId: "T02" });
      const job = await this.pipelineWorker.enqueueTask({
        ...scope,
        pipelineId: state.pipelineId,
        taskId: "T02",
        expectedStateVersion: state.version,
        input: { article_id: sourceArticleId, locale, source_snapshot_id: sourceSnapshotId, trace_id: traceId },
        nextTaskId: "T03",
      });
      pipelines.push({ ...scope, pipelineId: state.pipelineId, jobId: job.job?.jobId || null });
    }
    this.logger.info?.("pipeline_stage_dispatched", {
      sourceArticleId,
      locale,
      count: pipelines.length,
      mode: audit?.mode || "off",
      admit: audit?.admit ?? null,
      eligible_n: companies.length,
      it_mapped_n: audit?.itMappedCompanyIds?.length || 0,
      would_skip_n: audit?.wouldSkipCompanyIds?.length || 0,
      identity_bypass_n: audit?.identityBypassCompanyIds?.length || 0,
      scorer_ms: audit?.scorerMs ?? null,
    });
    return { count: pipelines.length, pipelines, prefilter: audit };
  }

  async _shadowIndustryPrefilter({ sourceSnapshotId, sourceArticleId, locale, companies }) {
    const requested = String(this.prefilter?.mode || "off").toLowerCase();
    if (requested === "off") return { mode: "off" };
    if (requested === "enforce") {
      this.logger.warn?.("industry_prefilter_enforce_ignored", { reason: "phase1_shadow_only" });
    } else if (requested !== "shadow") {
      return { mode: "off" };
    }

    const article = await this._loadArticle({ sourceSnapshotId, sourceArticleId, locale });
    const title = article?.title || "";
    const summary = article?.summary || "";
    const body = article?.content || article?.body || "";

    let score = {
      ok: false,
      admit: null,
      stage1: null,
      stage2: null,
      stage1Threshold: null,
      stage2Threshold: null,
      modelVersion: "it-v4",
      scorerMs: 0,
      error: this.prefilter.scorer ? null : "scorer_not_configured",
    };
    if (typeof this.prefilter.scorer?.score === "function") {
      score = await this.prefilter.scorer.score({ title, summary, content: body });
    }

    const itMappedCompanyIds = [];
    const identityBypassCompanyIds = [];
    const wouldSkipCompanyIds = [];
    for (const company of companies) {
      const fields = company.fields || {};
      const industryId = mapIndustry(fields);
      const identityHit = hasCompanyIdentityHit({ fields, title, summary, body });
      if (industryId === "it") itMappedCompanyIds.push(company.companyId);
      if (identityHit) identityBypassCompanyIds.push(company.companyId);
      if (industryId === "it" && score.admit === false && !identityHit) {
        wouldSkipCompanyIds.push(company.companyId);
      }
    }

    if (this.prefilter.decisionStore?.upsert && sourceSnapshotId) {
      try {
        await this.prefilter.decisionStore.upsert({
          snapshotId: sourceSnapshotId,
          sourceArticleId,
          locale,
          industryId: "it",
          admit: score.admit,
          stage1Score: score.stage1,
          stage2Score: score.stage2,
          stage1Threshold: score.stage1Threshold,
          stage2Threshold: score.stage2Threshold,
          modelVersion: score.modelVersion || "it-v4",
          mode: "shadow",
          payload: {
            would_skip_company_ids: wouldSkipCompanyIds,
            identity_bypass_company_ids: identityBypassCompanyIds,
            it_mapped_company_ids: itMappedCompanyIds,
            scorer_error: score.error || null,
            scorer_ok: score.ok === true,
            eligible_n: companies.length,
          },
        });
      } catch (error) {
        this.logger.error?.("industry_prefilter_persist_failed", { error: error?.message || "persist_failed" });
      }
    }

    return {
      mode: "shadow",
      admit: score.admit,
      wouldSkipCompanyIds,
      identityBypassCompanyIds,
      itMappedCompanyIds,
      scorerMs: score.scorerMs,
      error: score.error || null,
    };
  }

  async _loadArticle({ sourceSnapshotId, sourceArticleId, locale }) {
    const store = this.prefilter?.snapshotStore;
    if (!store) return null;
    try {
      if (sourceSnapshotId && typeof store.getById === "function") {
        const byId = await store.getById({ snapshotId: sourceSnapshotId });
        if (byId?.article) return byId.article;
      }
      if (sourceArticleId && typeof store.get === "function") {
        const byArticle = await store.get({ sourceArticleId, locale });
        if (byArticle?.article) return byArticle.article;
      }
    } catch (error) {
      this.logger.warn?.("industry_prefilter_snapshot_miss", { error: error?.message || "snapshot_miss" });
    }
    return null;
  }
}

module.exports = { PipelineStageDispatcher };
