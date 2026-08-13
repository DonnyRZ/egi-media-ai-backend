"use strict";

const { randomUUID } = require("crypto");

class PostgresArticleIndustryDecisionStore {
  constructor({ db, uuid = randomUUID } = {}) {
    if (!db?.query) throw new TypeError("Postgres article industry decision store requires db");
    this.db = db;
    this.uuid = uuid;
  }

  async get({ snapshotId, industryId, modelVersion }) {
    const result = await this.db.query(
      "SELECT * FROM ai.article_industry_decisions WHERE snapshot_id=$1 AND industry_id=$2 AND model_version=$3 LIMIT 1",
      [snapshotId, industryId, modelVersion],
    );
    return result.rows[0] ? mapDecision(result.rows[0]) : null;
  }

  async upsert(input) {
    const id = input.decisionId || this.uuid();
    const payload = input.payload || {};
    const result = await this.db.query(
      `INSERT INTO ai.article_industry_decisions (
         id, snapshot_id, source_article_id, locale, industry_id, admit,
         stage1_score, stage2_score, stage1_threshold, stage2_threshold,
         model_version, mode, payload_jsonb
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
       ON CONFLICT (snapshot_id, industry_id, model_version) DO UPDATE SET
         source_article_id = EXCLUDED.source_article_id,
         locale = EXCLUDED.locale,
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
        input.snapshotId,
        input.sourceArticleId,
        input.locale || null,
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
}

function mapDecision(row) {
  return {
    decisionId: row.id,
    snapshotId: row.snapshot_id,
    sourceArticleId: row.source_article_id,
    locale: row.locale,
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

module.exports = { PostgresArticleIndustryDecisionStore };
