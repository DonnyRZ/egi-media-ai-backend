"use strict";

const { CmsSourceGateError } = require("../cms/cms-source.errors");
const { SUPPORTED_LOCALES } = require("../cms/citation-url");
const { formatCrawlIssueSourceId, parseIssueSourceId } = require("../cms/issue-source-id");

// Crawl adapters collect Indonesian media only; crawl rows carry no locale column.
const CRAWL_CONTENT_LOCALE = "id";

/**
 * Read-only issue source gate for the 17 registered crawl media.
 * Returns the same normalized shape the T0x services already consume from
 * CmsSourceGate, plus additive provider metadata (thumbnail_url included).
 */
class CrawlSourceGate {
  constructor({ crawlArticleReader }) {
    if (!crawlArticleReader?.getArticleByContentHash) {
      throw new CmsSourceGateError("Crawl source gate requires a read-only crawl article reader", {
        code: "CRAWL_SOURCE_CONFIGURATION_INVALID",
      });
    }
    this.crawlArticleReader = crawlArticleReader;
  }

  async requirePublishedArticle({ articleId, locale, reference = null }) {
    const parsed = reference || parseIssueSourceId(articleId);
    if (parsed.provider !== "crawl") {
      throw new CmsSourceGateError("Crawl source gate only accepts crawl:<source_id>:<content_hash>", {
        code: "ISSUE_SOURCE_ID_INVALID",
        details: { articleId },
      });
    }
    if (!SUPPORTED_LOCALES.includes(locale)) {
      throw new CmsSourceGateError("Requested article locale is not supported", {
        code: "CMS_SOURCE_LOCALE_INVALID",
        details: { locale },
      });
    }

    const { row } = await this.crawlArticleReader.getArticleByContentHash({
      sourceId: parsed.sourceId,
      contentHash: parsed.contentHash,
    });
    return normalizeCrawlSource({ row, parsed, locale });
  }
}

function normalizeCrawlSource({ row, parsed, locale }) {
  const issueSourceId = formatCrawlIssueSourceId({
    sourceId: parsed.sourceId,
    contentHash: parsed.contentHash,
  });

  // Citations must point at the real media, never at the EGI portal.
  const canonicalUrl = nonEmptyString(row.canonical_url) || nonEmptyString(row.normalized_url);
  if (!canonicalUrl) {
    throw new CmsSourceGateError("Crawl article has no citable media URL", {
      code: "CRAWL_SOURCE_MALFORMED_ARTICLE",
      details: { articleId: issueSourceId },
    });
  }
  const publishedAt = toIso(row.published_at) || toIso(row.collected_at);
  if (!publishedAt) {
    throw new CmsSourceGateError("Crawl article has an invalid published timestamp", {
      code: "CRAWL_SOURCE_MALFORMED_ARTICLE",
      details: { articleId: issueSourceId },
    });
  }
  if (row.content_hash && row.content_hash !== parsed.contentHash) {
    throw new CmsSourceGateError("Crawl article response content hash does not match request", {
      code: "CRAWL_SOURCE_MALFORMED_ARTICLE",
      details: { articleId: issueSourceId },
    });
  }

  return Object.freeze({
    sourceArticleId: issueSourceId,
    requestedLocale: locale,
    contentLocale: CRAWL_CONTENT_LOCALE,
    canonicalUrl,
    provider: "crawl",
    issueSourceId,
    metadata: Object.freeze({
      provider: "crawl",
      crawl_source_id: parsed.sourceId,
      content_hash: parsed.contentHash,
      crawl_article_id: row.article_id === null || row.article_id === undefined ? null : String(row.article_id),
      external_article_id: nonEmptyString(row.external_article_id),
      thumbnail_url: nonEmptyString(row.thumbnail_url),
      collected_at: toIso(row.collected_at),
      source_url: canonicalUrl,
    }),
    article: Object.freeze({
      id: issueSourceId,
      title: nonEmptyString(row.title),
      summary: nonEmptyString(row.summary),
      content: nonEmptyString(row.content_text),
      status: "published",
      publishedAt,
      updatedAt: null,
    }),
  });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function toIso(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

module.exports = { CRAWL_CONTENT_LOCALE, CrawlSourceGate, normalizeCrawlSource };
