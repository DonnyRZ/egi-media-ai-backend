"use strict";

const { randomUUID } = require("crypto");
const {
  decodeCursor,
  encodeCursor,
  toIsoString,
} = require("./crawl-article-reader");

class InMemoryCrawlIndustryDecisionStore {
  constructor({ uuid = randomUUID } = {}) {
    this.uuid = uuid;
    this.rows = new Map();
    this.cursors = new Map();
  }

  key({ sourceId, contentHash, industryId, modelVersion }) {
    return `${sourceId}|${contentHash}|${industryId}|${modelVersion}`;
  }

  async get({ sourceId, contentHash, industryId, modelVersion }) {
    const value = this.rows.get(this.key({ sourceId, contentHash, industryId, modelVersion }));
    return value ? structuredClone(value) : null;
  }

  async upsert(input) {
    const value = {
      decisionId: input.decisionId || this.uuid(),
      sourceId: input.sourceId,
      contentHash: input.contentHash,
      sourceArticleId: input.sourceArticleId,
      crawlArticleId: String(input.crawlArticleId),
      effectiveTimestamp: toIsoString(input.effectiveTimestamp),
      industryId: input.industryId,
      admit: input.admit,
      stage1Score: input.stage1Score,
      stage2Score: input.stage2Score,
      stage1Threshold: input.stage1Threshold,
      stage2Threshold: input.stage2Threshold,
      modelVersion: input.modelVersion || "it-v4",
      mode: input.mode,
      payload: input.payload || {},
      createdAt: new Date().toISOString(),
    };
    this.rows.set(this.key(value), value);
    return structuredClone(value);
  }

  async listAdmitted({
    sourceIds = [],
    cursor = null,
    limit = 20,
    industryId = "it",
    modelVersion = "it-v4",
  } = {}) {
    const allowed = new Set((Array.isArray(sourceIds) ? sourceIds : []).filter(Boolean));
    if (!allowed.size) return { items: [], next_cursor: null };
    const decoded = decodeCursor(cursor);
    const cursorTs = decoded?.effectiveTimestamp ? Date.parse(decoded.effectiveTimestamp) : null;
    const cursorId = decoded?.articleId ? BigInt(decoded.articleId) : null;
    const items = [...this.rows.values()]
      .filter((row) => row.admit === true
        && row.industryId === industryId
        && row.modelVersion === modelVersion
        && (!allowed.size || allowed.has(row.sourceId)))
      .filter((row) => {
        if (cursorTs == null) return true;
        const ts = Date.parse(row.effectiveTimestamp);
        const id = BigInt(row.crawlArticleId);
        return ts < cursorTs || (ts === cursorTs && id < cursorId);
      })
      .sort((a, b) => {
        const ts = Date.parse(b.effectiveTimestamp) - Date.parse(a.effectiveTimestamp);
        if (ts !== 0) return ts;
        const delta = BigInt(b.crawlArticleId) - BigInt(a.crawlArticleId);
        return delta > 0n ? 1 : delta < 0n ? -1 : 0;
      });
    const hasMore = items.length > limit;
    const page = items.slice(0, limit).map((row) => structuredClone(row));
    return {
      items: page,
      next_cursor: hasMore && page.length
        ? encodeCursor({
          effectiveTimestamp: page[page.length - 1].effectiveTimestamp,
          articleId: page[page.length - 1].crawlArticleId,
        })
        : null,
    };
  }

  async getCursor({ sourceId, modelVersion }) {
    const value = this.cursors.get(`${sourceId}|${modelVersion}`);
    return value ? structuredClone(value) : null;
  }

  async setCursor({ sourceId, modelVersion, watermark }) {
    const value = {
      sourceId,
      modelVersion,
      watermark: toIsoString(watermark),
    };
    this.cursors.set(`${sourceId}|${modelVersion}`, value);
    return structuredClone(value);
  }
}

module.exports = { InMemoryCrawlIndustryDecisionStore };
