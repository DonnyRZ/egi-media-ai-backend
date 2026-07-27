"use strict";

const { getChannel, CRAWL_SOURCE_IDS } = require("../news-feed/channel-registry");
const { CmsSourceGateError } = require("./cms-source.errors");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{8,128}$/i;
const CRAWL_SOURCE_ID_SET = new Set(CRAWL_SOURCE_IDS);

/**
 * Parse an issue-pipeline source reference.
 * Supported:
 *   - bare <uuid>              → CMS (legacy backward compat)
 *   - cms:<uuid>               → CMS
 *   - crawl:<source_id>:<key>  → crawl (key = content_hash per ADR)
 * Rejected:
 *   - viral:… / viral_x / bare non-UUID
 *   - unknown crawl source_id / feeds_issues=false
 */
function parseIssueSourceId(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new CmsSourceGateError("Issue source ID is required", {
      code: "ISSUE_SOURCE_ID_INVALID",
      details: { articleId: raw ?? null },
    });
  }

  const value = raw.trim();

  if (UUID_PATTERN.test(value)) {
    return Object.freeze({
      provider: "cms",
      legacyBareUuid: true,
      cmsArticleId: value,
      formatted: value,
      raw: value,
    });
  }

  const colon = value.indexOf(":");
  if (colon <= 0) {
    throw new CmsSourceGateError("Issue source ID is invalid", {
      code: "ISSUE_SOURCE_ID_INVALID",
      details: { articleId: value },
    });
  }

  const prefix = value.slice(0, colon).toLowerCase();
  const remainder = value.slice(colon + 1);

  if (prefix === "viral" || prefix === "viral_x") {
    throw new CmsSourceGateError("Viral sources cannot enter the issue pipeline", {
      code: "ISSUE_SOURCE_VIRAL_REJECTED",
      details: { articleId: value },
    });
  }

  if (prefix === "cms") {
    if (!UUID_PATTERN.test(remainder)) {
      throw new CmsSourceGateError("CMS issue source ID must be cms:<uuid>", {
        code: "ISSUE_SOURCE_ID_INVALID",
        details: { articleId: value },
      });
    }
    return Object.freeze({
      provider: "cms",
      legacyBareUuid: false,
      cmsArticleId: remainder,
      formatted: formatCmsIssueSourceId(remainder),
      raw: value,
    });
  }

  if (prefix === "crawl") {
    const separator = remainder.indexOf(":");
    if (separator <= 0 || separator === remainder.length - 1) {
      throw new CmsSourceGateError("Crawl issue source ID must be crawl:<source_id>:<content_hash>", {
        code: "ISSUE_SOURCE_ID_INVALID",
        details: { articleId: value },
      });
    }
    const sourceId = remainder.slice(0, separator);
    const contentHash = remainder.slice(separator + 1);
    if (!CRAWL_SOURCE_ID_SET.has(sourceId)) {
      throw new CmsSourceGateError("Crawl source_id is not a registered issue-feed channel", {
        code: "ISSUE_SOURCE_CRAWL_CHANNEL_INVALID",
        details: { articleId: value, sourceId },
      });
    }
    const channel = getChannel(sourceId);
    if (!channel || channel.provider !== "crawl" || channel.feeds_issues !== true) {
      throw new CmsSourceGateError("Crawl channel is not eligible for the issue pipeline", {
        code: "ISSUE_SOURCE_CRAWL_CHANNEL_INVALID",
        details: { articleId: value, sourceId },
      });
    }
    if (!CONTENT_HASH_PATTERN.test(contentHash) || contentHash.includes(":")) {
      throw new CmsSourceGateError("Crawl content_hash key is malformed", {
        code: "ISSUE_SOURCE_ID_INVALID",
        details: { articleId: value, sourceId },
      });
    }
    return Object.freeze({
      provider: "crawl",
      legacyBareUuid: false,
      sourceId,
      contentHash,
      formatted: formatCrawlIssueSourceId({ sourceId, contentHash }),
      raw: value,
    });
  }

  throw new CmsSourceGateError("Issue source ID prefix is not supported", {
    code: "ISSUE_SOURCE_ID_INVALID",
    details: { articleId: value, prefix },
  });
}

function formatCmsIssueSourceId(cmsArticleId) {
  if (!UUID_PATTERN.test(cmsArticleId || "")) {
    throw new CmsSourceGateError("CMS article ID must be a UUID", {
      code: "ISSUE_SOURCE_ID_INVALID",
      details: { cmsArticleId: cmsArticleId ?? null },
    });
  }
  return `cms:${cmsArticleId}`;
}

function formatCrawlIssueSourceId({ sourceId, contentHash }) {
  if (!CRAWL_SOURCE_ID_SET.has(sourceId)) {
    throw new CmsSourceGateError("Crawl source_id is not a registered issue-feed channel", {
      code: "ISSUE_SOURCE_CRAWL_CHANNEL_INVALID",
      details: { sourceId },
    });
  }
  if (!CONTENT_HASH_PATTERN.test(contentHash || "") || String(contentHash).includes(":")) {
    throw new CmsSourceGateError("Crawl content_hash key is malformed", {
      code: "ISSUE_SOURCE_ID_INVALID",
      details: { sourceId, contentHash: contentHash ?? null },
    });
  }
  return `crawl:${sourceId}:${contentHash}`;
}

function isUuid(value) {
  return UUID_PATTERN.test(value || "");
}

module.exports = {
  CONTENT_HASH_PATTERN,
  UUID_PATTERN,
  formatCmsIssueSourceId,
  formatCrawlIssueSourceId,
  isUuid,
  parseIssueSourceId,
};
