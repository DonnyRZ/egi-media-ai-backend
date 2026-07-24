const { randomUUID } = require("crypto");
const { InMemoryIssueStore } = require("../issues/issue.store");

function json(value) { return JSON.stringify(value ?? {}); }

/** PostgreSQL-backed issue aggregate. The in-memory implementation remains the
 * domain behavior; this adapter hydrates it and durably writes every mutation. */
class PostgresIssueStore extends InMemoryIssueStore {
  constructor({ db, uuid = randomUUID, now = Date.now } = {}) {
    super({ uuid, now });
    if (!db) throw new TypeError("PostgresIssueStore requires a database adapter");
    this.db = db;
    this.ready = this._hydrate();
  }

  async _hydrate() {
    const issues = await this.db.query("SELECT * FROM ai.issues");
    for (const row of issues.rows) this.seed(mapIssue(row));
    const priorities = await this.db.query("SELECT DISTINCT ON (tenant_id,company_id,issue_id) tenant_id,company_id,issue_id,id,analysis_id,priority FROM ai.issue_priorities ORDER BY tenant_id,company_id,issue_id,effective_at DESC");
    for (const row of priorities.rows) {
      const issue = this.issuesById.get(row.issue_id);
      if (!issue || issue.tenantId !== row.tenant_id || issue.companyId !== row.company_id) continue;
      issue.currentPriority = issue.currentPriority || row.priority;
      issue.currentPriorityAnalysisId = issue.currentPriorityAnalysisId || row.analysis_id;
      issue.currentPriorityDecisionId = issue.currentPriorityDecisionId || row.id;
    }
    const articles = await this.db.query("SELECT * FROM ai.issue_articles");
    for (const row of articles.rows) {
      const article = mapArticle(row);
      this.issueArticlesByKey.set(`${article.issueId}|${article.sourceArticleId}|${article.locale}|${article.sourceUpdatedAt || "unknown"}`, article);
    }
    const developments = await this.db.query("SELECT * FROM ai.issue_developments");
    for (const row of developments.rows) this.developmentsById.set(row.id, mapDevelopment(row));
  }

  async listActive(args) { await this.ready; return super.listActive(args); }
  async listScoped(args) { await this.ready; return super.listScoped(args); }
  async getIssue(args) { await this.ready; return super.getIssue(args); }
  async listArticles(args) { await this.ready; return super.listArticles(args); }
  async listDevelopments(args) { await this.ready; return super.listDevelopments(args); }
  async getLatestDevelopment(args) { await this.ready; return super.getLatestDevelopment(args); }
  async getDevelopment(args) { await this.ready; return super.getDevelopment(args); }
  async getArticleForDevelopment(args) { await this.ready; return super.getArticleForDevelopment(args); }
  async getGeneratedTitle(args) { await this.ready; return super.getGeneratedTitle(args); }
  async getGeneratedOneLiner(args) { await this.ready; return super.getGeneratedOneLiner(args); }
  async getAlertContentReadiness({ tenantId, companyId, issueId }) {
    await this.ready;
    const issue = super.getIssue({ tenantId, companyId, issueId });
    if (!issue) return null;
    const missingFields = [];
    if (!(typeof issue.title === "string" && issue.title.trim())) missingFields.push("title");
    if (!(typeof issue.oneLiner === "string" && issue.oneLiner.trim())) missingFields.push("one_liner");
    return { contentReady: missingFields.length === 0, missingFields };
  }
  async getArticleForDevelopment({ tenantId, companyId, developmentId }) {
    await this.ready;
    const development = super.getDevelopment({ tenantId, companyId, developmentId });
    if (!development || typeof development.issueArticleId !== "string") return null;
    const article = [...this.issueArticlesByKey.values()].find((item) => item.issueArticleId === development.issueArticleId);
    return article && article.tenantId === tenantId && article.companyId === companyId ? structuredClone(article) : null;
  }
  async getMutation(id) { await this.ready; return super.getMutation(id); }

  async apply(args) {
    await this.ready;
    const result = super.apply(args);
    if (!result.reused) await this._persistMutation(result.mutation);
    return result;
  }
  async applyGeneratedTitle(args) { await this.ready; const result = super.applyGeneratedTitle(args); if (!result.reused) await this._persistIssue(args.issueId); return result; }
  async applyGeneratedOneLiner(args) { await this.ready; const result = super.applyGeneratedOneLiner(args); if (!result.reused) await this._persistIssue(args.issueId); return result; }
  async applyCurrentPriority(args) { await this.ready; const result = super.applyCurrentPriority(args); if (!result.reused) await this._persistIssue(args.issueId); return result; }
  async complete(args) { await this.ready; const result = super.complete(args); if (!result.reused) await this._persistIssue(args.issueId); return result; }

  async _persistMutation(mutation) {
    await this._persistIssue(mutation.issueId);
    const article = mutation.issueArticleId && [...this.issueArticlesByKey.values()].find((item) => item.issueArticleId === mutation.issueArticleId);
    if (article) await this.db.query("INSERT INTO ai.issue_articles (id,tenant_id,company_id,issue_id,article_snapshot_id,payload_jsonb,attached_at,relation_status) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT (issue_id,article_snapshot_id) DO NOTHING", [article.issueArticleId, article.tenantId, article.companyId, article.issueId, article.sourceArticleId, json(article), article.attachedAt, article.relationStatus]);
    const development = mutation.developmentId && this.developmentsById.get(mutation.developmentId);
    if (development) await this.db.query("INSERT INTO ai.issue_developments (id,tenant_id,company_id,issue_id,article_snapshot_id,development_type,observed_at,is_material,payload_jsonb,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) ON CONFLICT (id) DO NOTHING", [development.developmentId, development.tenantId, development.companyId, development.issueId, article?.sourceArticleId || null, development.developmentType, development.observedAt, development.isMaterial, json(development), development.createdAt]);
  }
  async _persistIssue(issueId) {
    const issue = this.issuesById.get(issueId);
    if (!issue) return;
    await this.db.query("INSERT INTO ai.issues (id,tenant_id,company_id,title,one_liner,status,current_priority,first_seen_at,last_developed_at,version,closed_at,payload_jsonb,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,one_liner=EXCLUDED.one_liner,status=EXCLUDED.status,current_priority=EXCLUDED.current_priority,last_developed_at=EXCLUDED.last_developed_at,version=EXCLUDED.version,closed_at=EXCLUDED.closed_at,payload_jsonb=EXCLUDED.payload_jsonb,updated_at=EXCLUDED.updated_at", [issue.issueId, issue.tenantId, issue.companyId, issue.title, issue.oneLiner, issue.status, issue.currentPriority, issue.firstSeenAt, issue.lastDevelopedAt, issue.version, issue.closedAt, json(issue), issue.createdAt, issue.updatedAt]);
  }
}

function mapIssue(row) { return { ...(row.payload_jsonb || {}), issueId: row.id, tenantId: row.tenant_id, companyId: row.company_id, title: row.title, oneLiner: row.one_liner, status: row.status, currentPriority: row.current_priority, firstSeenAt: new Date(row.first_seen_at).toISOString(), lastDevelopedAt: new Date(row.last_developed_at).toISOString(), version: row.version, closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }; }
function mapArticle(row) { return { ...(row.payload_jsonb || {}), issueArticleId: row.id, tenantId: row.tenant_id, companyId: row.company_id, issueId: row.issue_id, sourceArticleId: row.article_snapshot_id, attachedAt: new Date(row.attached_at).toISOString(), relationStatus: row.relation_status }; }
function mapDevelopment(row) { return { ...(row.payload_jsonb || {}), developmentId: row.id, tenantId: row.tenant_id, companyId: row.company_id, issueId: row.issue_id, developmentType: row.development_type, observedAt: new Date(row.observed_at).toISOString(), isMaterial: row.is_material, createdAt: new Date(row.created_at).toISOString() }; }

module.exports = { PostgresIssueStore };
