"use strict";

function readNewsFeedV4Config(env = process.env) {
  const lookbackDays = Number(env.NEWS_FEED_V4_LOOKBACK_DAYS || 14);
  const intervalMs = Number(env.NEWS_FEED_V4_INTERVAL_MS || 900000);
  const scoreTimeoutMs = Number(env.NEWS_FEED_V4_SCORE_TIMEOUT_MS || 30000);
  const pageSize = Number(env.NEWS_FEED_V4_PAGE_SIZE || 50);
  const maxArticlesPerTick = Number(env.NEWS_FEED_V4_MAX_ARTICLES_PER_TICK || 200);
  return {
    enabled: env.NEWS_FEED_V4_ENABLED === "true",
    tenantId: env.NEWS_FEED_V4_TENANT_ID || "it-holding",
    lookbackDays: Number.isInteger(lookbackDays) && lookbackDays > 0 ? lookbackDays : 14,
    intervalMs: Number.isInteger(intervalMs) && intervalMs >= 1000 ? intervalMs : 900000,
    scoreTimeoutMs: Number.isInteger(scoreTimeoutMs) && scoreTimeoutMs >= 1000 ? scoreTimeoutMs : 30000,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 50,
    maxArticlesPerTick: Number.isInteger(maxArticlesPerTick) && maxArticlesPerTick > 0
      ? maxArticlesPerTick
      : 200,
    industryId: "it",
    modelVersion: "it-v4",
  };
}

module.exports = { readNewsFeedV4Config };
