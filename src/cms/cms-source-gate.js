const { CmsSourceGateError } = require("./cms-source.errors");
const { SUPPORTED_LOCALES, buildCanonicalArticleUrl } = require("./citation-url");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class CmsSourceGate {
  constructor({ cmsArticleClient, portalBaseUrl }) {
    if (!cmsArticleClient?.getArticleById) {
      throw new CmsSourceGateError("CMS source gate requires a read-only article client", {
        code: "CMS_SOURCE_CONFIGURATION_INVALID",
      });
    }
    this.cmsArticleClient = cmsArticleClient;
    this.portalBaseUrl = portalBaseUrl;
  }

  async requirePublishedArticle({ articleId, locale }) {
    if (!UUID_PATTERN.test(articleId || "")) {
      throw new CmsSourceGateError("Article ID must be a UUID", { code: "CMS_SOURCE_ARTICLE_ID_INVALID" });
    }
    if (!SUPPORTED_LOCALES.includes(locale)) {
      throw new CmsSourceGateError("Requested article locale is not supported", {
        code: "CMS_SOURCE_LOCALE_INVALID", details: { locale },
      });
    }
    const article = await this.cmsArticleClient.getArticleById({ articleId, locale });
    if (!article) {
      throw new CmsSourceGateError("CMS article was not found or has been deleted", {
        code: "CMS_SOURCE_NOT_FOUND", details: { articleId },
      });
    }
    if (article.id !== articleId) {
      throw new CmsSourceGateError("CMS article response ID does not match request", { code: "CMS_SOURCE_MALFORMED_ARTICLE" });
    }
    if (article.status !== "published") {
      throw new CmsSourceGateError("CMS article is not published", {
        code: "CMS_SOURCE_NOT_PUBLISHED", details: { articleId, status: article.status || null },
      });
    }
    if (article.deleted_at !== undefined && article.deleted_at !== null) {
      throw new CmsSourceGateError("CMS article is deleted", { code: "CMS_SOURCE_DELETED", details: { articleId } });
    }
    if (!article.published_at || Number.isNaN(Date.parse(article.published_at))) {
      throw new CmsSourceGateError("CMS article has an invalid published timestamp", { code: "CMS_SOURCE_MALFORMED_ARTICLE" });
    }
    if (article.locale !== undefined && !SUPPORTED_LOCALES.includes(article.locale)) {
      throw new CmsSourceGateError("CMS article locale is invalid", { code: "CMS_SOURCE_MALFORMED_ARTICLE" });
    }

    return Object.freeze({
      sourceArticleId: article.id,
      requestedLocale: locale,
      contentLocale: article.locale || locale,
      canonicalUrl: buildCanonicalArticleUrl({ portalBaseUrl: this.portalBaseUrl, locale, articleId }),
      provider: "cms",
      issueSourceId: `cms:${article.id}`,
      metadata: Object.freeze({
        provider: "cms",
        crawl_source_id: null,
        content_hash: null,
        thumbnail_url: typeof article.featured_image === "string" && article.featured_image.trim()
          ? article.featured_image
          : null,
      }),
      article: Object.freeze({
        id: article.id,
        title: article.title || null,
        summary: article.summary || null,
        content: article.content || null,
        status: article.status,
        publishedAt: article.published_at,
        updatedAt: article.updated_at || null,
      }),
    });
  }
}

module.exports = { CmsSourceGate };
