"use strict";

const { CmsSourceGateError } = require("../cms/cms-source.errors");
const { CRAWL_SOURCE_IDS } = require("../news-feed/channel-registry");
const { assessArticleContent } = require("../ingest/content-quality-gate");
const { assertChannelAllowed, loadTenant } = require("../auth/tenant-news-policy");

const DEFAULT_LIMIT = 25;

/**
 * F4 scope: discover crawl articles for one registered media since a stored
 * watermark and push them through the same snapshot + relevance-stage path the
 * CMS ingest worker uses. Scheduler automation stays out of F4 — callers
 * (internal ingest trigger or an operator script) invoke `pollSource`.
 */
class CrawlIngestService {
  constructor({ crawlArticleReader, sourceGate, snapshotStore, watermarkStore, enqueueStageJob, now = Date.now, assessContent = assessArticleContent, logger = null, getTenantStore = null }) {
    if (!crawlArticleReader?.listArticlesSince) {
      throw new CmsSourceGateError("Crawl ingest requires a read-only crawl article reader", {
        code: "CRAWL_SOURCE_CONFIGURATION_INVALID",
      });
    }
    if (!sourceGate?.requirePublishedArticle) {
      throw new CmsSourceGateError("Crawl ingest requires the issue source resolver", {
        code: "CMS_SOURCE_CONFIGURATION_INVALID",
      });
    }
    if (!snapshotStore?.upsert || !watermarkStore?.get || !watermarkStore?.set) {
      throw new TypeError("Crawl ingest requires snapshot and watermark persistence");
    }
    if (typeof enqueueStageJob !== "function") {
      throw new TypeError("Crawl ingest requires a stage job enqueue function");
    }
    Object.assign(this, { crawlArticleReader, sourceGate, snapshotStore, watermarkStore, enqueueStageJob, now, assessContent, logger: logger || { info() {}, warn() {} }, getTenantStore });
  }

  static watermarkName(sourceId) {
    return `crawl:${sourceId}`;
  }

  async pollSource({ tenantId, companyId, sourceId, locale = "id", limit = DEFAULT_LIMIT }) {
    if (!CRAWL_SOURCE_IDS.includes(sourceId)) {
      throw new CmsSourceGateError("Crawl source_id is not a registered issue-feed channel", {
        code: "ISSUE_SOURCE_CRAWL_CHANNEL_INVALID",
        details: { sourceId },
      });
    }
    const tenant = await loadTenant(this.getTenantStore, tenantId);
    assertChannelAllowed(tenant, sourceId);
    const sourceName = CrawlIngestService.watermarkName(sourceId);
    const previous = await this.watermarkStore.get({ sourceName, locale });
    const page = await this.crawlArticleReader.listArticlesSince({
      sourceId,
      since: previous?.watermark || null,
      limit,
    });

    const snapshots = [];
    const stageJobs = [];
    const skipped = [];
    for (const item of page.items) {
      const source = await this.sourceGate.requirePublishedArticle({
        articleId: item.issue_source_id,
        locale,
      });
      const quality = this.assessContent(source.article);
      if (!quality.ok) {
        skipped.push({
          sourceArticleId: source.sourceArticleId,
          skipReason: quality.reason,
          skipDetails: quality.details,
        });
        this.logger.info("ingest_content_quality_skipped", {
          mode: "crawl-poll",
          tenantId,
          companyId,
          sourceId,
          sourceArticleId: source.sourceArticleId,
          skipReason: quality.reason,
          skipDetails: quality.details,
        });
        continue;
      }
      const stored = await this.snapshotStore.upsert({
        sourceArticleId: source.sourceArticleId,
        locale,
        canonicalUrl: source.canonicalUrl,
        article: source.article,
        observedAt: this.now(),
      });
      snapshots.push(stored.snapshot);
      stageJobs.push(await this.enqueueStageJob({
        tenantId,
        companyId,
        stage: "relevance",
        sourceSnapshotId: stored.snapshot.snapshotId,
        sourceArticleId: source.sourceArticleId,
        locale,
      }));
    }

    const watermark = await this.watermarkStore.set({
      sourceName,
      locale,
      watermark: page.watermark || previous?.watermark || new Date(this.now()).toISOString(),
      cursor: null,
    });
    return { mode: "crawl-poll", sourceId, count: snapshots.length, skippedCount: skipped.length, skipped, snapshots, stageJobs, watermark };
  }
}

module.exports = { CrawlIngestService, DEFAULT_CRAWL_INGEST_LIMIT: DEFAULT_LIMIT };
