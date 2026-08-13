"use strict";

const { randomUUID } = require("crypto");

class InMemoryArticleIndustryDecisionStore {
  constructor({ uuid = randomUUID } = {}) {
    this.uuid = uuid;
    this.rows = new Map();
  }

  key({ snapshotId, industryId, modelVersion }) {
    return `${snapshotId}|${industryId}|${modelVersion}`;
  }

  async get({ snapshotId, industryId, modelVersion }) {
    const value = this.rows.get(this.key({ snapshotId, industryId, modelVersion }));
    return value ? structuredClone(value) : null;
  }

  async upsert(input) {
    const value = {
      decisionId: input.decisionId || this.uuid(),
      snapshotId: input.snapshotId,
      sourceArticleId: input.sourceArticleId,
      locale: input.locale || null,
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
}

module.exports = { InMemoryArticleIndustryDecisionStore };
