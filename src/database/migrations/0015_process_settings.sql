CREATE TABLE IF NOT EXISTS ai.process_settings (
  key text PRIMARY KEY,
  value_jsonb jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
