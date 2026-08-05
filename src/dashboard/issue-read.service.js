const { AiConfigurationError } = require("../ai/provider/provider.errors");

class IssueReadService {
  constructor({ issueStore, analysisStore, priorityStore, authorizeCompany = denyByDefault }) {
    if (!issueStore?.listScoped || !issueStore?.getIssue) throw new AiConfigurationError("Issue read API requires scoped issue reads");
    Object.assign(this, { issueStore, analysisStore, priorityStore, authorizeCompany });
  }
  async list({ tenantId, companyId, q = null, status = null, priority = null, period = null, page = 1, limit = 20 }) {
    await this._authorize(tenantId, companyId);
    const query = typeof q === "string" ? q.trim().toLowerCase() : "";
    const cutoff = periodCutoff(period);
    const filtered = (await this.issueStore.listScoped({ tenantId, companyId })).filter((issue) =>
      (!status || issue.status === status) && (!priority || issue.currentPriority === priority)
      && (!cutoff || Date.parse(issue.lastDevelopedAt || issue.firstSeenAt) >= cutoff)
      && (!query || `${issue.title || ""} ${issue.oneLiner || ""}`.toLowerCase().includes(query)));
    const total = filtered.length;
    const offset = (page - 1) * limit;
    return { items: filtered.slice(offset, offset + limit).map((issue) => this._card(issue)), page, limit, total };
  }
  async detail({ tenantId, companyId, issueId }) {
    await this._authorize(tenantId, companyId);
    const issue = await this.issueStore.getIssue({ tenantId, companyId, issueId });
    if (!issue) throw Object.assign(new Error("Issue was not found"), { code: "NOT_FOUND", statusCode: 404 });
    const analysis = await this.analysisStore?.getCurrent?.({ tenantId, companyId, issueId }) || null;
    const priority = analysis && await this.priorityStore?.get?.({ tenantId, companyId, issueId, analysisId: analysis.analysisId, promptVersion: "1.0.0" }) || null;
    const articles = await this.issueStore.listArticles({ tenantId, companyId, issueId });
    const articleBySourceId = new Map(articles.map((article) => [article.sourceArticleId, article]));
    const enrichEvidence = (evidence) => Array.isArray(evidence) ? evidence.map((item) => {
      const article = articleBySourceId.get(item.sourceArticleId);
      return article ? { ...item, title: article.title, sourceName: article.sourceName, publishedAt: article.publishedAt } : item;
    }) : evidence;
    return {
      ...this._card(issue),
      articles,
      developments: await this.issueStore.listDevelopments({ tenantId, companyId, issueId }),
      analysis: analysis ? { ...analysis, evidence: enrichEvidence(analysis.evidence) } : analysis, priority,
    };
  }
  _card(issue) { return { issue_id: issue.issueId, title: issue.title, one_liner: issue.oneLiner, status: issue.status, priority: issue.currentPriority, first_seen_at: issue.firstSeenAt, last_developed_at: issue.lastDevelopedAt, version: issue.version }; }
  async _authorize(tenantId, companyId) { if (await this.authorizeCompany({ tenantId, companyId, action: "issues.read" }) !== true) throw Object.assign(new Error("Issue read was not authorized"), { code: "FORBIDDEN", statusCode: 403 }); }
}
function periodCutoff(period) { const hours = period === "24jam" ? 24 : period === "7hari" ? 24 * 7 : period === "30hari" ? 24 * 30 : null; return hours ? Date.now() - hours * 60 * 60 * 1000 : null; }
function denyByDefault() { throw new AiConfigurationError("Issue read API requires a company authorization guard"); }
module.exports = { IssueReadService };
