"use strict";

const { createCrawlDatabase } = require("../database/crawl-db");
const { getChannel } = require("./channel-registry");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_QUERY_TIMEOUT_MS = 3000;

const ARTICLE_COLUMNS = `
    article_id,
    source_id,
    external_article_id,
    canonical_url,
    normalized_url,
    title,
    summary,
    content_text,
    thumbnail_url,
    published_at,
    collected_at,
    content_hash,
    COALESCE(published_at, collected_at) AS effective_timestamp`;

const ARTICLE_SELECT = `
  SELECT${ARTICLE_COLUMNS}
  FROM articles
  WHERE source_id = $1
    AND validation_status = 'valid'
    AND (
      $2::timestamptz IS NULL
      OR (COALESCE(published_at, collected_at), article_id) < ($2::timestamptz, $3::bigint)
    )
  ORDER BY COALESCE(published_at, collected_at) DESC, article_id DESC
  LIMIT $4
`;

const ARTICLE_BY_HASH_SELECT = `
  SELECT${ARTICLE_COLUMNS}
  FROM articles
  WHERE source_id = $1
    AND content_hash = $2
    AND validation_status = 'valid'
  ORDER BY COALESCE(published_at, collected_at) DESC, article_id DESC
  LIMIT 1
`;

const ARTICLE_SINCE_SELECT = `
  SELECT${ARTICLE_COLUMNS}
  FROM articles
  WHERE source_id = $1
    AND validation_status = 'valid'
    AND (
      $2::timestamptz IS NULL
      OR COALESCE(published_at, collected_at) > $2::timestamptz
    )
  ORDER BY COALESCE(published_at, collected_at) ASC, article_id ASC
  LIMIT $3
`;

const ARTICLE_MIXED_SELECT = `
  SELECT${ARTICLE_COLUMNS}
  FROM articles
  WHERE source_id = ANY($1::text[])
    AND validation_status = 'valid'
    AND (
      $5::text[] IS NULL
      OR title ILIKE ANY($5::text[])
      OR COALESCE(summary, '') ILIKE ANY($5::text[])
    )
    AND (
      $2::timestamptz IS NULL
      OR (COALESCE(published_at, collected_at), article_id) < ($2::timestamptz, $3::bigint)
    )
  ORDER BY COALESCE(published_at, collected_at) DESC, article_id DESC
  LIMIT $4
`;

class InvalidCrawlChannelError extends Error {
  constructor(channelId) {
    super(`Channel is not a registered crawl channel: ${String(channelId)}`);
    this.name = "InvalidCrawlChannelError";
    this.code = "INVALID_CRAWL_CHANNEL";
    this.channelId = channelId;
    this.retryable = false;
  }
}

class InvalidCrawlCursorError extends Error {
  constructor() {
    super("Invalid crawl article cursor");
    this.name = "InvalidCrawlCursorError";
    this.code = "INVALID_CRAWL_CURSOR";
    this.retryable = false;
  }
}

class CrawlArticleNotFoundError extends Error {
  constructor({ sourceId, contentHash } = {}) {
    super("Crawl article was not found or is not valid");
    this.name = "CrawlArticleNotFoundError";
    this.code = "CRAWL_SOURCE_NOT_FOUND";
    this.retryable = false;
    this.source = "crawl";
    this.details = { sourceId: sourceId ?? null, contentHash: contentHash ?? null };
  }
}

class CrawlSourceUnavailableError extends Error {
  constructor(message = "Crawl article source is temporarily unavailable", options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "CrawlSourceUnavailableError";
    this.code = "CRAWL_SOURCE_UNAVAILABLE";
    this.retryable = true;
    this.source = "crawl";
  }
}

function createCrawlArticleReader(options = {}) {
  let database = options.db || null;
  const queryTimeoutMs = positiveInteger(
    options.queryTimeoutMs,
    positiveInteger(Number(process.env.CRAWL_DB_QUERY_TIMEOUT_MS), DEFAULT_QUERY_TIMEOUT_MS)
  );

  async function listArticles({ channelId, limit = DEFAULT_LIMIT, cursor = null } = {}) {
    const channel = getChannel(channelId);
    if (!channel || channel.provider !== "crawl" || channel.crawl_source_id !== channelId) {
      throw new InvalidCrawlChannelError(channelId);
    }

    const pageLimit = validateLimit(limit);
    const decodedCursor = decodeCursor(cursor);

    try {
      if (!database) database = createCrawlDatabase({ queryTimeoutMs });
      const result = await withTimeout(
        database.query(ARTICLE_SELECT, [
          channel.crawl_source_id,
          decodedCursor?.effectiveTimestamp || null,
          decodedCursor?.articleId || null,
          pageLimit + 1,
        ]),
        queryTimeoutMs
      );
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      const hasMore = rows.length > pageLimit;
      const pageRows = rows.slice(0, pageLimit);
      return {
        items: pageRows.map((row) => mapCrawlArticle(row, channel)),
        next_cursor: hasMore && pageRows.length
          ? encodeCursor(cursorFromRow(pageRows[pageRows.length - 1]))
          : null,
      };
    } catch (error) {
      if (isPassthroughError(error)) throw error;
      throw new CrawlSourceUnavailableError(undefined, { cause: error });
    }
  }

  async function listMixedArticles({
    sourceIds = [],
    limit = DEFAULT_LIMIT,
    cursor = null,
    terms = null,
  } = {}) {
    const ids = uniqueSourceIds(sourceIds);
    if (!ids.length) {
      return { items: [], next_cursor: null };
    }

    const pageLimit = validateLimit(limit);
    const decodedCursor = decodeCursor(cursor);
    const termPatterns = normalizeTermPatterns(terms);

    try {
      if (!database) database = createCrawlDatabase({ queryTimeoutMs });
      const result = await withTimeout(
        database.query(ARTICLE_MIXED_SELECT, [
          ids,
          decodedCursor?.effectiveTimestamp || null,
          decodedCursor?.articleId || null,
          pageLimit + 1,
          termPatterns,
        ]),
        queryTimeoutMs
      );
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      const mapped = [];
      for (const row of rows) {
        const channel = getChannel(row.source_id);
        if (!channel || channel.provider !== "crawl") continue;
        mapped.push(mapCrawlArticle(row, channel));
      }
      const hasMore = mapped.length > pageLimit;
      const pageItems = mapped.slice(0, pageLimit);
      return {
        items: pageItems,
        next_cursor: hasMore && pageItems.length
          ? encodeCursor(cursorFromRow(rows[pageItems.length - 1]))
          : null,
      };
    } catch (error) {
      if (isPassthroughError(error)) throw error;
      throw new CrawlSourceUnavailableError(undefined, { cause: error });
    }
  }

  async function getArticleByContentHash({ sourceId, contentHash } = {}) {
    const channel = requireCrawlChannel(sourceId);
    if (typeof contentHash !== "string" || !contentHash.trim()) {
      throw new CrawlArticleNotFoundError({ sourceId, contentHash: contentHash ?? null });
    }

    const rows = await runQuery(ARTICLE_BY_HASH_SELECT, [channel.crawl_source_id, contentHash]);
    const row = rows[0];
    if (!row) throw new CrawlArticleNotFoundError({ sourceId: channel.crawl_source_id, contentHash });
    return { row, channel };
  }

  async function listArticlesSince({ sourceId, since = null, limit = DEFAULT_LIMIT } = {}) {
    const channel = requireCrawlChannel(sourceId);
    const pageLimit = validateLimit(limit);
    const watermark = normalizeWatermark(since);

    const rows = await runQuery(ARTICLE_SINCE_SELECT, [channel.crawl_source_id, watermark, pageLimit]);
    const items = rows.map((row) => mapCrawlArticle(row, channel));
    const nextWatermark = rows.length
      ? toIsoString(rows[rows.length - 1].effective_timestamp)
        || toIsoString(rows[rows.length - 1].published_at)
        || toIsoString(rows[rows.length - 1].collected_at)
      : watermark;
    return { items, watermark: nextWatermark };
  }

  async function runQuery(sql, values) {
    try {
      if (!database) database = createCrawlDatabase({ queryTimeoutMs });
      const result = await withTimeout(database.query(sql, values), queryTimeoutMs);
      return Array.isArray(result?.rows) ? result.rows : [];
    } catch (error) {
      if (isPassthroughError(error)) throw error;
      throw new CrawlSourceUnavailableError(undefined, { cause: error });
    }
  }

  return { listArticles, listMixedArticles, getArticleByContentHash, listArticlesSince };
}

function requireCrawlChannel(sourceId) {
  const channel = getChannel(sourceId);
  if (!channel || channel.provider !== "crawl" || channel.crawl_source_id !== sourceId || channel.feeds_issues !== true) {
    throw new InvalidCrawlChannelError(sourceId);
  }
  return channel;
}

function normalizeWatermark(since) {
  if (since === null || since === undefined || since === "") return null;
  const date = since instanceof Date ? since : new Date(since);
  if (!Number.isFinite(date.getTime())) {
    const error = new Error("Crawl watermark must be a valid timestamp");
    error.code = "INVALID_CRAWL_WATERMARK";
    error.retryable = false;
    throw error;
  }
  return date.toISOString();
}

function isPassthroughError(error) {
  return error instanceof InvalidCrawlChannelError
    || error instanceof InvalidCrawlCursorError
    || error instanceof CrawlArticleNotFoundError
    || error?.code === "INVALID_CRAWL_LIMIT"
    || error?.code === "INVALID_CRAWL_WATERMARK";
}

function mapCrawlArticle(row, channel) {
  const sourceUrl = nonEmptyString(row.canonical_url) || nonEmptyString(row.normalized_url) || null;
  const issueSourceId = `crawl:${channel.crawl_source_id}:${row.content_hash}`;
  return {
    id: issueSourceId,
    channel: channel.id,
    provider: channel.provider,
    layout: channel.layout,
    title: row.title,
    summary: row.summary ?? null,
    published_at: toIsoString(row.published_at),
    source_url: sourceUrl,
    thumbnail_url: nonEmptyString(row.thumbnail_url) || null,
    crawl_source_id: channel.crawl_source_id,
    issue_source_id: issueSourceId,
    source_label: channel.label,
  };
}

function uniqueSourceIds(sourceIds) {
  return [...new Set((Array.isArray(sourceIds) ? sourceIds : [])
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim()))];
}

function normalizeTermPatterns(terms) {
  if (!Array.isArray(terms) || !terms.length) return null;
  const patterns = terms
    .filter((term) => typeof term === "string" && term.trim() && term.trim().length <= 40)
    .map((term) => `%${term.trim()}%`);
  return patterns.length ? patterns : null;
}

function cursorFromRow(row) {
  return {
    effectiveTimestamp: toIsoString(row.effective_timestamp)
      || toIsoString(row.published_at)
      || toIsoString(row.collected_at),
    articleId: String(row.article_id),
  };
}

function encodeCursor(value) {
  if (!value?.effectiveTimestamp || !/^\d+$/.test(String(value.articleId))) {
    throw new InvalidCrawlCursorError();
  }
  return Buffer.from(JSON.stringify({
    v: 1,
    t: value.effectiveTimestamp,
    id: String(value.articleId),
  }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (cursor === null || cursor === undefined || cursor === "") return null;
  if (typeof cursor !== "string") throw new InvalidCrawlCursorError();
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      decoded?.v !== 1
      || typeof decoded.t !== "string"
      || !Number.isFinite(Date.parse(decoded.t))
      || !/^\d+$/.test(String(decoded.id))
    ) {
      throw new InvalidCrawlCursorError();
    }
    return { effectiveTimestamp: new Date(decoded.t).toISOString(), articleId: String(decoded.id) };
  } catch (error) {
    if (error instanceof InvalidCrawlCursorError) throw error;
    throw new InvalidCrawlCursorError();
  }
}

function validateLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    const error = new Error(`Crawl article limit must be an integer from 1 to ${MAX_LIMIT}`);
    error.code = "INVALID_CRAWL_LIMIT";
    error.retryable = false;
    throw error;
  }
  return limit;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function toIsoString(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Crawl database query timed out after ${timeoutMs}ms`);
      error.code = "CRAWL_QUERY_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

module.exports = {
  ARTICLE_BY_HASH_SELECT,
  ARTICLE_SELECT,
  ARTICLE_SINCE_SELECT,
  ARTICLE_MIXED_SELECT,
  CrawlArticleNotFoundError,
  CrawlSourceUnavailableError,
  InvalidCrawlChannelError,
  InvalidCrawlCursorError,
  createCrawlArticleReader,
  decodeCursor,
  encodeCursor,
  mapCrawlArticle,
  toIsoString,
};
