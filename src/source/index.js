"use strict";

const { CRAWL_CONTENT_LOCALE, CrawlSourceGate, normalizeCrawlSource } = require("./crawl-source-gate");
const { IssueSourceResolver, createIssueSourceResolver } = require("./issue-source-resolver");
const { CrawlIngestService, DEFAULT_CRAWL_INGEST_LIMIT } = require("./crawl-ingest.service");
const {
  formatCmsIssueSourceId,
  formatCrawlIssueSourceId,
  isUuid,
  parseIssueSourceId,
} = require("../cms/issue-source-id");

module.exports = {
  CRAWL_CONTENT_LOCALE,
  CrawlIngestService,
  CrawlSourceGate,
  DEFAULT_CRAWL_INGEST_LIMIT,
  IssueSourceResolver,
  createIssueSourceResolver,
  formatCmsIssueSourceId,
  formatCrawlIssueSourceId,
  isUuid,
  normalizeCrawlSource,
  parseIssueSourceId,
};
