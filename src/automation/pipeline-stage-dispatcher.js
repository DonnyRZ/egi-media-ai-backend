class PipelineStageDispatcher {
  constructor({ companyStore, pipelineStateStore, pipelineWorker, logger = null } = {}) { if (!companyStore?.listEligible || !pipelineStateStore?.create || !pipelineWorker?.enqueueTask) throw new TypeError("Pipeline stage dispatcher requires company, state, and worker services"); Object.assign(this, { companyStore, pipelineStateStore, pipelineWorker, logger: logger || { info() {}, warn() {}, error() {} } }); }
  async dispatch({ sourceSnapshotId, sourceArticleId, source_snapshot_id, source_article_id, locale, traceId = null, trace_id = null }) {
    sourceSnapshotId = sourceSnapshotId || source_snapshot_id;
    sourceArticleId = sourceArticleId || source_article_id;
    traceId = traceId || trace_id;
    const companies = await this.companyStore.listEligible(); const pipelines = [];
    for (const scope of companies) {
      const state = await this.pipelineStateStore.create({ ...scope, currentTaskId: "T02" });
      const job = await this.pipelineWorker.enqueueTask({ ...scope, pipelineId: state.pipelineId, taskId: "T02", expectedStateVersion: state.version, input: { article_id: sourceArticleId, locale, source_snapshot_id: sourceSnapshotId, trace_id: traceId }, nextTaskId: "T03" });
      pipelines.push({ ...scope, pipelineId: state.pipelineId, jobId: job.job?.jobId || null });
    }
    this.logger.info?.("pipeline_stage_dispatched", { sourceArticleId, locale, count: pipelines.length });
    return { count: pipelines.length, pipelines };
  }
}
module.exports = { PipelineStageDispatcher };
