class IngestWorker {
  constructor({ sourceGate, articleListClient, snapshotStore, watermarkStore, enqueueStageJob, sourceName = "egi-media-cms", now = Date.now } = {}) {
    if (!sourceGate?.requirePublishedArticle) throw new TypeError("Ingest worker requires a CMS published source gate");
    if (!articleListClient?.listPublishedArticles) throw new TypeError("Ingest worker requires a CMS article list client");
    if (!snapshotStore?.upsert || !watermarkStore?.get || !watermarkStore?.set) throw new TypeError("Ingest worker requires snapshot and watermark persistence");
    if (typeof enqueueStageJob !== "function") throw new TypeError("Ingest worker requires a stage job enqueue function");
    Object.assign(this, { sourceGate, articleListClient, snapshotStore, watermarkStore, enqueueStageJob, sourceName, now });
  }
  async triggerArticle({ tenantId, companyId, articleId, locale }) { const source = await this.sourceGate.requirePublishedArticle({ articleId, locale }); const stored = await this.snapshotStore.upsert({ sourceArticleId: source.sourceArticleId, locale, canonicalUrl: source.canonicalUrl, article: source.article, observedAt: this.now() }); const job = await this.enqueueStageJob({ tenantId, companyId, stage: "relevance", sourceSnapshotId: stored.snapshot.snapshotId, sourceArticleId: source.sourceArticleId, locale }); return { mode: "article", snapshot: stored.snapshot, stageJob: job, reused: stored.reused }; }
  async poll({ tenantId, companyId, locale, limit = 50 }) {
    const previous = await this.watermarkStore.get({ sourceName: this.sourceName, locale }); const response = await this.articleListClient.listPublishedArticles({ locale, updatedSince: previous?.watermark || null, cursor: previous?.cursor || null, limit }); const articles = Array.isArray(response?.items) ? response.items : [];
    const snapshots = []; const stageJobs = []; let maxWatermark = previous?.watermark || null;
    for (const item of articles) { const source = await this.sourceGate.requirePublishedArticle({ articleId: item.id, locale }); const stored = await this.snapshotStore.upsert({ sourceArticleId: source.sourceArticleId, locale, canonicalUrl: source.canonicalUrl, article: source.article, observedAt: this.now() }); snapshots.push(stored.snapshot); stageJobs.push(await this.enqueueStageJob({ tenantId, companyId, stage: "relevance", sourceSnapshotId: stored.snapshot.snapshotId, sourceArticleId: source.sourceArticleId, locale })); const candidate = source.article.updatedAt || source.article.publishedAt; if (!maxWatermark || Date.parse(candidate) > Date.parse(maxWatermark)) maxWatermark = candidate; }
    const watermark = await this.watermarkStore.set({ sourceName: this.sourceName, locale, watermark: maxWatermark || new Date(this.now()).toISOString(), cursor: response?.nextCursor || null });
    return { mode: "poll", count: snapshots.length, snapshots, stageJobs, watermark };
  }
}
module.exports = { IngestWorker };
