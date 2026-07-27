"use strict";

const { CmsSourceGateError } = require("../cms/cms-source.errors");
const { parseIssueSourceId } = require("../cms/issue-source-id");
const { CrawlSourceGate } = require("./crawl-source-gate");

/**
 * Single entry point the issue pipeline (T02–T07 and ingest) uses to load a
 * source article. It routes by issue-source-id prefix:
 *   - bare <uuid> / cms:<uuid>            → CmsSourceGate (unchanged behavior)
 *   - crawl:<source_id>:<content_hash>    → CrawlSourceGate (read-only crawl DB)
 *   - viral:… / anything else             → structured rejection
 * The resolver keeps the `requirePublishedArticle({ articleId, locale })`
 * signature so it is a drop-in for the existing `cmsSourceGate` DI slot.
 */
class IssueSourceResolver {
  constructor({ cmsSourceGate, crawlSourceGate = null, crawlArticleReader = null }) {
    if (!cmsSourceGate?.requirePublishedArticle) {
      throw new CmsSourceGateError("Issue source resolver requires the CMS source gate", {
        code: "CMS_SOURCE_CONFIGURATION_INVALID",
      });
    }
    this.cmsSourceGate = cmsSourceGate;
    this.crawlSourceGate = crawlSourceGate
      || (crawlArticleReader ? new CrawlSourceGate({ crawlArticleReader }) : null);
    this.cmsArticleClient = cmsSourceGate.cmsArticleClient;
  }

  parse(articleId) {
    return parseIssueSourceId(articleId);
  }

  async requirePublishedArticle({ articleId, locale }) {
    const reference = parseIssueSourceId(articleId);

    if (reference.provider === "cms") {
      // Legacy bare UUIDs and cms:<uuid> both hit the untouched CMS gate.
      return this.cmsSourceGate.requirePublishedArticle({
        articleId: reference.cmsArticleId,
        locale,
      });
    }

    if (!this.crawlSourceGate) {
      throw new CmsSourceGateError("Crawl issue sources are not configured", {
        code: "CRAWL_SOURCE_CONFIGURATION_INVALID",
        details: { articleId },
      });
    }
    return this.crawlSourceGate.requirePublishedArticle({ articleId, locale, reference });
  }
}

function createIssueSourceResolver({ cmsSourceGate, crawlSourceGate = null, crawlArticleReader = null }) {
  return new IssueSourceResolver({ cmsSourceGate, crawlSourceGate, crawlArticleReader });
}

module.exports = { IssueSourceResolver, createIssueSourceResolver };
