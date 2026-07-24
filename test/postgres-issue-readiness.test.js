const test = require("node:test");
const assert = require("node:assert/strict");
const { PostgresIssueStore } = require("../src/persistence/postgres-issue-store");

test("Postgres issue alert readiness reads hydrated title and one-liner", async () => {
  const store = new PostgresIssueStore({ db: {
    query: async (sql) => sql.includes("SELECT * FROM ai.issues")
      ? { rows: [{ id: "issue-1", tenant_id: "tenant-1", company_id: "company-1", title: "A real title", one_liner: "A real one-liner", status: "baru", current_priority: "tinggi", first_seen_at: "2026-07-24T00:00:00.000Z", last_developed_at: "2026-07-24T00:00:00.000Z", version: 1, closed_at: null, payload_jsonb: {}, created_at: "2026-07-24T00:00:00.000Z", updated_at: "2026-07-24T00:00:00.000Z" }] }
      : { rows: [] },
  } });
  assert.deepEqual(await store.getAlertContentReadiness({ tenantId: "tenant-1", companyId: "company-1", issueId: "issue-1" }), { contentReady: true, missingFields: [] });
});

test("Postgres issue article lookup resolves the development relation after hydration", async () => {
  const store = new PostgresIssueStore({ db: {
    query: async (sql) => {
      if (sql.includes("SELECT * FROM ai.issues")) return { rows: [] };
      if (sql.includes("SELECT * FROM ai.issue_articles")) return { rows: [{ id: "article-link-1", tenant_id: "tenant-1", company_id: "company-1", issue_id: "issue-1", article_snapshot_id: "article-1", attached_at: "2026-07-24T00:00:00.000Z", relation_status: "active", payload_jsonb: { canonicalUrl: "http://localhost:3000/id/articles/article-1", issueArticleId: "article-link-1" } }] };
      if (sql.includes("SELECT * FROM ai.issue_developments")) return { rows: [{ id: "development-1", tenant_id: "tenant-1", company_id: "company-1", issue_id: "issue-1", article_snapshot_id: "article-1", development_type: "created", observed_at: "2026-07-24T00:00:00.000Z", is_material: null, created_at: "2026-07-24T00:00:00.000Z", payload_jsonb: { issueArticleId: "article-link-1" } }] };
      return { rows: [] };
    },
  } });
  assert.equal((await store.getArticleForDevelopment({ tenantId: "tenant-1", companyId: "company-1", developmentId: "development-1" })).canonicalUrl, "http://localhost:3000/id/articles/article-1");
});
