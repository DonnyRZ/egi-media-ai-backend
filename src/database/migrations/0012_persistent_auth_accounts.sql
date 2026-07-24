ALTER TABLE ai.users ADD COLUMN IF NOT EXISTS password_hash text;
CREATE INDEX IF NOT EXISTS users_status_idx ON ai.users (status, created_at DESC);
