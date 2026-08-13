"use strict";

const { CRAWL_SOURCE_IDS } = require("./channel-registry");

function createCrawlIndustryScoreLoop({
  crawlArticleReader,
  decisionStore,
  scorer,
  sourceIds = CRAWL_SOURCE_IDS,
  lookbackDays = 14,
  intervalMs = 900000,
  pageSize = 50,
  maxArticlesPerTick = 200,
  industryId = "it",
  modelVersion = "it-v4",
  now = Date.now,
  logger = { info() {}, warn() {}, error() {} },
} = {}) {
  if (!crawlArticleReader?.listScoringCandidates) {
    throw new TypeError("Crawl industry score loop requires listScoringCandidates");
  }
  if (!decisionStore?.get || !decisionStore?.upsert || !decisionStore?.getCursor || !decisionStore?.setCursor) {
    throw new TypeError("Crawl industry score loop requires a crawl industry decision store");
  }
  if (typeof scorer?.score !== "function") {
    throw new TypeError("Crawl industry score loop requires a scorer");
  }

  let timer = null;
  let inFlight = false;

  async function tick() {
    if (inFlight) return { skipped: true, reason: "in_flight" };
    inFlight = true;
    const stats = { scored: 0, admitted: 0, skippedExisting: 0, errors: 0 };
    try {
      let remaining = maxArticlesPerTick;
      const lookbackSince = new Date(now() - lookbackDays * 86400000).toISOString();
      for (const sourceId of sourceIds) {
        if (remaining <= 0) break;
        const cursor = await decisionStore.getCursor({ sourceId, modelVersion });
        let since = cursor?.watermark || lookbackSince;
        while (remaining > 0) {
          const requested = Math.min(pageSize, remaining);
          const page = await crawlArticleReader.listScoringCandidates({
            sourceId,
            since,
            limit: requested,
          });
          if (!page.items.length) break;
          let failed = false;
          let lastOk = null;
          for (const item of page.items) {
            const existing = await decisionStore.get({
              sourceId: item.sourceId,
              contentHash: item.contentHash,
              industryId,
              modelVersion,
            });
            if (existing) {
              stats.skippedExisting += 1;
              lastOk = item.effectiveTimestamp;
              continue;
            }
            const scored = await scorer.score({
              title: item.title || "",
              summary: item.summary || "",
            });
            if (!scored?.ok) {
              stats.errors += 1;
              logger.warn("news_feed_v4_score_failed", {
                sourceId: item.sourceId,
                contentHash: item.contentHash,
                error: scored?.error || "scorer_failed",
              });
              failed = true;
              break;
            }
            await decisionStore.upsert({
              sourceId: item.sourceId,
              contentHash: item.contentHash,
              sourceArticleId: item.sourceArticleId,
              crawlArticleId: item.crawlArticleId,
              effectiveTimestamp: item.effectiveTimestamp,
              industryId,
              admit: scored.admit,
              stage1Score: scored.stage1,
              stage2Score: scored.stage2,
              stage1Threshold: scored.stage1Threshold,
              stage2Threshold: scored.stage2Threshold,
              modelVersion: scored.modelVersion || modelVersion,
              mode: "news_feed_v4",
              payload: {
                composition: scored.composition || "AND",
                scorerMs: scored.scorerMs,
              },
            });
            stats.scored += 1;
            if (scored.admit) stats.admitted += 1;
            lastOk = item.effectiveTimestamp;
            remaining -= 1;
            if (remaining <= 0) break;
          }
          if (lastOk) {
            await decisionStore.setCursor({ sourceId, modelVersion, watermark: lastOk });
            if (lastOk === since) break;
            since = lastOk;
          }
          if (failed) break;
          if (page.items.length < requested) break;
        }
      }
      logger.info("news_feed_v4_tick", stats);
      return stats;
    } catch (error) {
      logger.error("news_feed_v4_tick_failed", { error: error?.message || String(error) });
      throw error;
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (timer) return;
    const run = () => {
      tick().catch((error) => {
        logger.error("news_feed_v4_tick_unhandled", { error: error?.message || String(error) });
      });
    };
    run();
    timer = setInterval(run, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick };
}

module.exports = { createCrawlIndustryScoreLoop };
