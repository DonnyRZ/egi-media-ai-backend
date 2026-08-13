"use strict";

const { randomUUID } = require("crypto");
const {
  decodeCursor,
  encodeCursor,
  toIsoString,
} = require("../news-feed/crawl-article-reader");

class PostgresCrawlIndustryDecisionStore {
  constructor({ db, uuid = randomUUID } = {}) {
    if (!db?.query) throw new TypeError("Postgres crawl industry decision store requires db");
    this.db = db;
    this.uuid = uuid;
  }

  async get({ sourceId, contentHash, industryId, modelVersion }) {
    const result = await this.db.query(
      `SELECT * FROM ai.crawl_industry_decisions
       WHERE source_id=$1 AND content_hash=$2 AND industry_id=$3 AND model_version=$4
       LIMIT 1`,
      [sourceId, contentHash, industryId, modelVersion],
    );
    return result.rows[0] ? mapDecision(result.rows[0]) : null;
  }

  async upsert(input) {
    const id = input.decisionId || this.uuid();
    const payload = input.payload || {};
    const result = await this.db.query(
      `INSERT INTO ai.crawl_industry_decisions (
         id, source_id, content_hash, source_article_id, crawl_article_id, effective_timestamp,
         industry_id, admit, stage1_score, stage2_score, stage1_threshold, stage2_threshold,
         model_version, mode, payload_jsonb
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
       ON CONFLICT (source_id, content_hash, industry_id, model_version) DO UPDATE SET
         source_article_id = EXCLUDED.source_article_id,
         crawl_article_id = EXCLUDED.crawl_article_id,
         effective_timestamp = EXCLUDED.effective_timestamp,
         admit = EXCLUDED.admit,
         stage1_score = EXCLUDED.stage1_score,
         stage2_score = EXCLUDED.stage2_score,
         stage1_threshold = EXCLUDED.stage1_threshold,
         stage2_threshold = EXCLUDED.stage2_threshold,
         mode = EXCLUDED.mode,
         payload_jsonb = EXCLUDED.payload_jsonb
       RETURNING *`,
      [
        id,
        input.sourceId,
        input.contentHash,
        input.sourceArticleId,
        input.crawlArticleId,
        input.effectiveTimestamp,
        input.industryId,
        input.admit,
        input.stage1Score,
        input.stage2Score,
        input.stage1Threshold,
        input.stage2Threshold,
        input.modelVersion || "it-v4",
        input.mode,
        JSON.stringify(payload),
      ],
    );
    return mapDecision(result.rows[0]);
  }

  async listAdmitted({
    sourceIds = [],
    cursor = null,
    limit = 20,
    industryId = "it",
    modelVersion = "it-v4",
  } = {}) {
    const ids = uniqueIds(sourceIds);
    if (!ids.length) return { items: [], next_cursor: null };
    const decoded = decodeCursor(cursor);
    const result = await this.db.query(
      `SELECT * FROM ai.crawl_industry_decisions
       WHERE industry_id = $1
         AND model_version = $2
         AND admit IS TRUE
         AND source_id = ANY($3::text[])
         AND (
           $4::timestamptz IS NULL
           OR (effective_timestamp, crawl_article_id) < ($4::timestamptz, $5::bigint)
         )
       ORDER BY effective_timestamp DESC, crawl_article_id DESC
       LIMIT $6`,
      [
        industryId,
        modelVersion,
        ids,
        decoded?.effectiveTimestamp || null,
        decoded?.articleId || null,
        limit + 1,
      ],
    );
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    return {
      items: pageRows.map(mapDecision),
      next_cursor: hasMore && pageRows.length
        ? encodeCursor({
          effectiveTimestamp: toIsoString(pageRows[pageRows.length - 1].effective_timestamp),
          articleId: String(pageRows[pageRows.length - 1].crawl_article_id),
        })
        : null,
    };
  }

  async getCursor({ sourceId, modelVersion }) {
    const result = await this.db.query(
      `SELECT source_id, model_version, watermark
       FROM ai.crawl_industry_score_cursors
       WHERE source_id=$1 AND model_version=$2
       LIMIT 1`,
      [sourceId, modelVersion],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sourceId: row.source_id,
      modelVersion: row.model_version,
      watermark: toIsoString(row.watermark),
    };
  }

  async setCursor({ sourceId, modelVersion, watermark }) {
    const result = await this.db.query(
      `INSERT INTO ai.crawl_industry_score_cursors (source_id, model_version, watermark, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (source_id, model_version) DO UPDATE SET
         watermark = EXCLUDED.watermark,
         updated_at = now()
       RETURNING source_id, model_version, watermark`,
      [sourceId, modelVersion, watermark],
    );
    const row = result.rows[0];
    return {
      sourceId: row.source_id,
      modelVersion: row.model_version,
      watermark: toIsoString(row.watermark),
    };
  }
}

function mapDecision(row) {
  return {
    decisionId: row.id,
    sourceId: row.source_id,
    contentHash: row.content_hash,
    sourceArticleId: row.source_article_id,
    crawlArticleId: String(row.crawl_article_id),
    effectiveTimestamp: toIsoString(row.effective_timestamp),
    industryId: row.industry_id,
    admit: row.admit,
    stage1Score: row.stage1_score == null ? null : Number(row.stage1_score),
    stage2Score: row.stage2_score == null ? null : Number(row.stage2_score),
    stage1Threshold: row.stage1_threshold == null ? null : Number(row.stage1_threshold),
    stage2Threshold: row.stage2_threshold == null ? null : Number(row.stage2_threshold),
    modelVersion: row.model_version,
    mode: row.mode,
    payload: row.payload_jsonb || {},
    createdAt: row.created_at?.toISOString?.() || row.created_at,
  };
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim()))];
}

module.exports = { PostgresCrawlIndustryDecisionStore };
