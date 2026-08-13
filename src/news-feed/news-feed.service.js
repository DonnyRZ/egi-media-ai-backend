'use strict';

const { buildCanonicalArticleUrl, SUPPORTED_LOCALES } = require('../cms/citation-url');
const {
  DEFAULT_CHANNEL_ID,
  UnknownChannelError,
  requireChannel,
} = require('./channel-registry');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_LOCALE = 'id';
const VIRAL_COMING_SOON_MESSAGE = 'Coming soon';

function createNewsFeedService({
  crawlArticleReader,
  cmsArticleClient,
  portalBaseUrl,
  defaultLocale = DEFAULT_LOCALE,
} = {}) {
  if (!crawlArticleReader?.listArticles) {
    throw new TypeError('News feed service requires a crawl article reader');
  }
  if (!cmsArticleClient?.listPublishedArticles) {
    throw new TypeError('News feed service requires a CMS article list client');
  }
  if (typeof portalBaseUrl !== 'string' || !portalBaseUrl) {
    throw new TypeError('News feed service requires portalBaseUrl');
  }

  async function listFeed({
    channelId = DEFAULT_CHANNEL_ID,
    cursor = null,
    limit = DEFAULT_LIMIT,
  } = {}) {
    const channel = resolveChannel(channelId);
    const pageLimit = normalizeLimit(limit);

    if (channel.provider === 'viral_x') {
      return viralComingSoon(channel);
    }

    if (channel.provider === 'crawl') {
      const page = await crawlArticleReader.listArticles({
        channelId: channel.id,
        cursor: emptyToNull(cursor),
        limit: pageLimit,
      });
      return feedPage(channel, {
        items: Array.isArray(page?.items) ? page.items : [],
        next_cursor: page?.next_cursor ?? null,
      });
    }

    if (channel.provider === 'cms') {
      const page = await cmsArticleClient.listPublishedArticles({
        locale: defaultLocale,
        cursor: emptyToNull(cursor),
        limit: pageLimit,
      });
      return feedPage(channel, {
        items: (Array.isArray(page?.items) ? page.items : []).map((article) =>
          mapCmsArticle(article, channel, portalBaseUrl, defaultLocale)
        ),
        next_cursor: page?.nextCursor || page?.next_cursor || null,
      });
    }

    const error = new Error(`Unsupported news feed provider: ${channel.provider}`);
    error.code = 'VALIDATION_ERROR';
    error.statusCode = 400;
    throw error;
  }

  async function listMixedFeed({
    sourceIds = [],
    cursor = null,
    limit = DEFAULT_LIMIT,
    terms = null,
  } = {}) {
    if (typeof crawlArticleReader.listMixedArticles !== 'function') {
      const error = new Error('Mixed news feed is not configured');
      error.code = 'NOT_READY';
      error.statusCode = 503;
      throw error;
    }

    const page = await crawlArticleReader.listMixedArticles({
      sourceIds,
      cursor: emptyToNull(cursor),
      limit: normalizeLimit(limit),
      terms,
    });
    return {
      channel: 'mixed',
      label: 'News Feed',
      layout: 'card',
      provider: 'crawl',
      items: Array.isArray(page?.items) ? page.items : [],
      next_cursor: page?.next_cursor ?? null,
    };
  }

  return { listFeed, listMixedFeed };
}

function resolveChannel(channelId) {
  const id = channelId === undefined || channelId === null || channelId === ''
    ? DEFAULT_CHANNEL_ID
    : channelId;
  try {
    return requireChannel(id);
  } catch (error) {
    if (error instanceof UnknownChannelError) {
      error.statusCode = 400;
    }
    throw error;
  }
}

function viralComingSoon(channel) {
  return {
    channel: channel.id,
    label: channel.label,
    layout: channel.layout,
    provider: channel.provider,
    items: [],
    next_cursor: null,
    availability: 'coming_soon',
    message: VIRAL_COMING_SOON_MESSAGE,
  };
}

function feedPage(channel, { items, next_cursor }) {
  return {
    channel: channel.id,
    label: channel.label,
    layout: channel.layout,
    provider: channel.provider,
    items,
    next_cursor,
  };
}

function mapCmsArticle(article, channel, portalBaseUrl, locale) {
  const articleId = String(article?.id || '');
  const issueSourceId = articleId ? `cms:${articleId}` : null;
  const contentLocale = SUPPORTED_LOCALES.includes(article?.locale) ? article.locale : locale;
  const sourceUrl = articleId
    ? buildCanonicalArticleUrl({ portalBaseUrl, locale: contentLocale, articleId })
    : null;

  return {
    id: issueSourceId || articleId,
    channel: channel.id,
    provider: channel.provider,
    layout: channel.layout,
    title: article?.title ?? null,
    summary: article?.summary ?? null,
    published_at: toIsoString(article?.published_at),
    source_url: nonEmptyString(article?.canonical_url)
      || nonEmptyString(article?.source_url)
      || sourceUrl,
    thumbnail_url: nonEmptyString(article?.featured_image)
      || nonEmptyString(article?.thumbnail_url)
      || null,
    crawl_source_id: null,
    issue_source_id: issueSourceId,
  };
}

function normalizeLimit(limit) {
  if (limit === undefined || limit === null || limit === '') return DEFAULT_LIMIT;
  const parsed = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1) {
    const error = new Error(`News feed limit must be an integer from 1 to ${MAX_LIMIT}`);
    error.code = 'VALIDATION_ERROR';
    error.statusCode = 400;
    throw error;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function emptyToNull(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function toIsoString(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  VIRAL_COMING_SOON_MESSAGE,
  createNewsFeedService,
  mapCmsArticle,
  normalizeLimit,
};
