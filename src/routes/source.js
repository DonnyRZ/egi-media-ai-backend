const express = require("express");
const { requireAuthContext } = require("../auth/auth-context");
const { getRequestId, getCorrelationId } = require("../app/request-context");
const { sendError } = require("../app/error-contract");

function createSourceRouter({ cmsSourceGate } = {}) {
  const router = express.Router();

  router.get("/api/v1/internal/source/articles/:articleId", optionalSaaSScope({ permission: "ai.pipeline.run" }), asyncHandler(async (req, res) => {
    if (!cmsSourceGate?.requirePublishedArticle) {
      return sendError(res, req, Object.assign(new Error("CMS source gate is not configured"), { code: "NOT_READY", statusCode: 503 }));
    }
    const source = await cmsSourceGate.requirePublishedArticle({
      articleId: req.params.articleId,
      locale: req.query.locale || req.query.lang || "id",
    });
    return res.status(200).json({
      success: true,
      data: {
        source_article_id: source.sourceArticleId,
        requested_locale: source.requestedLocale,
        content_locale: source.contentLocale,
        citation_url: source.canonicalUrl,
        article: {
          id: source.article.id,
          title: source.article.title,
          summary: source.article.summary,
          content: source.article.content,
          status: source.article.status,
          published_at: source.article.publishedAt,
          updated_at: source.article.updatedAt,
        },
      },
      meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) },
    });
  }));
  router.get("/api/v1/articles/:articleId/source", optionalSaaSScope({ permission: "issue.read" }), asyncHandler(async (req, res) => {
    if (!cmsSourceGate?.requirePublishedArticle) return sendError(res, req, Object.assign(new Error("CMS source gate is not configured"), { code: "NOT_READY", statusCode: 503 }));
    const source = await cmsSourceGate.requirePublishedArticle({ articleId: req.params.articleId, locale: req.query.locale || req.query.lang || "id" });
    return res.status(200).json({ success: true, data: { source_article_id: source.sourceArticleId, requested_locale: source.requestedLocale, content_locale: source.contentLocale, citation_url: source.canonicalUrl, article: { id: source.article.id, title: source.article.title, summary: source.article.summary, content: source.article.content, status: source.article.status, published_at: source.article.publishedAt, updated_at: source.article.updatedAt } }, meta: { request_id: getRequestId(req), correlation_id: getCorrelationId(req) } });
  }));

  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}

function optionalSaaSScope(options) {
  const authentication = requireAuthContext({ tenant: false, company: false });
  const guard = requireAuthContext({ tenant: true, company: true, trustedScope: true, ...options });
  return (req, res, next) => authentication(req, res, (error) => {
    if (error) return next(error);
    return req.app?.locals?.authorizationService ? guard(req, res, next) : next();
  });
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { createSourceRouter };
