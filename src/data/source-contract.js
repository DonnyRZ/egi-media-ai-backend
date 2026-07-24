const ARTICLE_SOURCE_FIELDS = Object.freeze([
  "id", "category_id", "series_id", "author_id", "title", "slug", "summary",
  "content", "status", "published_at", "created_at", "updated_at", "deleted_at",
]);

const COMPANY_CONTEXT_SOURCE_FIELDS = Object.freeze([
  "user_id", "company", "industry", "job_title", "seniority", "country",
]);

const ARTICLE_SELECT = `SELECT ${ARTICLE_SOURCE_FIELDS.map((field) => `a.${field}`).join(", ")} FROM public.articles a`;
const COMPANY_CONTEXT_SELECT = `SELECT ${COMPANY_CONTEXT_SOURCE_FIELDS.map((field) => `p.${field}`).join(", ")} FROM public.user_profiles p`;

module.exports = { ARTICLE_SOURCE_FIELDS, COMPANY_CONTEXT_SOURCE_FIELDS, ARTICLE_SELECT, COMPANY_CONTEXT_SELECT };
