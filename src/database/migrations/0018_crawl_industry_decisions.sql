-- Crawl-keyed IT v4 decisions for News Feed. Not ingest snapshots and not T02.
CREATE TABLE IF NOT EXISTS ai.crawl_industry_decisions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_article_id TEXT NOT NULL,
  crawl_article_id BIGINT NOT NULL,
  effective_timestamp TIMESTAMPTZ NOT NULL,
  industry_id TEXT NOT NULL,
  admit BOOLEAN NOT NULL,
  stage1_score DOUBLE PRECISION,
  stage2_score DOUBLE PRECISION,
  stage1_threshold DOUBLE PRECISION,
  stage2_threshold DOUBLE PRECISION,
  model_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  payload_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, content_hash, industry_id, model_version)
);

CREATE INDEX IF NOT EXISTS crawl_industry_decisions_admitted_feed_idx
  ON ai.crawl_industry_decisions (model_version, industry_id, effective_timestamp DESC, crawl_article_id DESC)
  WHERE admit IS TRUE;

CREATE TABLE IF NOT EXISTS ai.crawl_industry_score_cursors (
  source_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  watermark TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, model_version)
);
