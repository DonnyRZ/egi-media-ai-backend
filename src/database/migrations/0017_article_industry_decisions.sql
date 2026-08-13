-- Article-level industry prefilter audit. Not company relevance (article_relevance).
CREATE TABLE IF NOT EXISTS ai.article_industry_decisions (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  source_article_id TEXT NOT NULL,
  locale TEXT,
  industry_id TEXT NOT NULL,
  admit BOOLEAN,
  stage1_score DOUBLE PRECISION,
  stage2_score DOUBLE PRECISION,
  stage1_threshold DOUBLE PRECISION,
  stage2_threshold DOUBLE PRECISION,
  model_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  payload_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, industry_id, model_version)
);

CREATE INDEX IF NOT EXISTS article_industry_decisions_article_idx
  ON ai.article_industry_decisions (source_article_id, locale, created_at DESC);
