-- M16: company IDs are only unique within a tenant, therefore uniqueness
-- constraints must include tenant_id wherever the business key is scoped.
DROP INDEX IF EXISTS ai.company_contexts_one_effective;
ALTER TABLE ai.company_contexts DROP CONSTRAINT IF EXISTS company_contexts_company_id_version_key;
CREATE UNIQUE INDEX IF NOT EXISTS company_contexts_one_effective_scoped ON ai.company_contexts (tenant_id, company_id) WHERE status = 'effective';
CREATE UNIQUE INDEX IF NOT EXISTS company_contexts_version_scoped ON ai.company_contexts (tenant_id, company_id, version);

ALTER TABLE ai.article_relevance DROP CONSTRAINT IF EXISTS article_relevance_company_id_article_snapshot_id_context_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS article_relevance_scope_key ON ai.article_relevance (tenant_id, company_id, article_snapshot_id, context_id);

ALTER TABLE ai.alert_preferences DROP CONSTRAINT IF EXISTS alert_preferences_company_id_user_ref_key;
CREATE UNIQUE INDEX IF NOT EXISTS alert_preferences_scope_key ON ai.alert_preferences (tenant_id, company_id, user_ref);

ALTER TABLE ai.reports DROP CONSTRAINT IF EXISTS reports_company_id_report_type_period_start_period_end_key;
CREATE UNIQUE INDEX IF NOT EXISTS reports_scope_period_key ON ai.reports (tenant_id, company_id, report_type, period_start, period_end);

CREATE INDEX IF NOT EXISTS issues_scope_dashboard_idx ON ai.issues (tenant_id, company_id, status, current_priority, last_developed_at DESC, id);
CREATE INDEX IF NOT EXISTS issue_articles_scope_key_idx ON ai.issue_articles (tenant_id, company_id, issue_id, article_snapshot_id);
CREATE INDEX IF NOT EXISTS issue_developments_scope_idx ON ai.issue_developments (tenant_id, company_id, issue_id, observed_at DESC);
