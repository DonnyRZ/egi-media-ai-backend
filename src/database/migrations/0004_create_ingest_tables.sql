CREATE TABLE IF NOT EXISTS ai.source_watermarks (
  source_name text NOT NULL,
  locale text NOT NULL,
  watermark timestamptz NOT NULL,
  cursor text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_name, locale)
);
CREATE TABLE IF NOT EXISTS ai.article_snapshots (
  id text PRIMARY KEY,
  source_article_id text NOT NULL,
  locale text NOT NULL,
  canonical_url text NOT NULL,
  fingerprint text NOT NULL,
  article_jsonb jsonb NOT NULL,
  published_at timestamptz NOT NULL,
  source_updated_at timestamptz,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_article_id, locale, fingerprint)
);
CREATE INDEX IF NOT EXISTS article_snapshots_source_idx ON ai.article_snapshots (source_article_id, locale, source_updated_at DESC);
