'use strict';

const express = require('express');
const { requireAuthContext } = require('../auth/auth-context');
const { getRequestId, getCorrelationId } = require('../app/request-context');
const { sendError } = require('../app/error-contract');
const {
  InvalidCrawlChannelError,
  InvalidCrawlCursorError,
  CrawlSourceUnavailableError,
} = require('../news-feed/crawl-article-reader');
const { UnknownChannelError, requireChannel } = require('../news-feed/channel-registry');
const { IT_FEED_TERMS } = require('../news-feed/it-feed-terms');
const { readNewsFeedV4Config } = require('../news-feed/v4-config');
const {
  assertChannelAllowed,
  listEntitledChannels,
  loadTenant,
  resolveDefaultChannelId,
} = require('../auth/tenant-news-policy');

function createNewsFeedRouter({ getNewsFeedService, getTenantStore, getNewsFeedV4Config } = {}) {
  const router = express.Router();
  const scope = requireAuthContext({
    tenant: true,
    company: true,
    trustedScope: true,
    permission: 'dashboard.read',
  });

  router.get('/api/v1/news-feed/channels', scope, asyncHandler(async (req, res) => {
    scopedCompany(req, req.query.company_id || req.authContext.companyId);
    const tenant = await loadTenant(getTenantStore, req.authContext.tenantId);
    return success(res, { items: listEntitledChannels(tenant) }, req);
  }));

  router.get('/api/v1/news-feed', scope, asyncHandler(async (req, res) => {
    if (typeof getNewsFeedService !== 'function') {
      return sendError(res, req, Object.assign(new Error('News feed service is not configured'), {
        code: 'NOT_READY',
        statusCode: 503,
      }));
    }

    scopedCompany(req, req.query.company_id || req.authContext.companyId);

    try {
      const tenant = await loadTenant(getTenantStore, req.authContext.tenantId);
      if (isMixedView(req.query.view)) {
        const sourceIds = listEntitledChannels(tenant)
          .filter((channel) => channel.provider === 'crawl')
          .map((channel) => channel.id);
        const v4 = typeof getNewsFeedV4Config === 'function'
          ? getNewsFeedV4Config()
          : readNewsFeedV4Config();
        const useV4 = Boolean(v4?.enabled && v4.tenantId && req.authContext.tenantId === v4.tenantId);
        const result = await getNewsFeedService().listMixedFeed({
          sourceIds,
          cursor: req.query.cursor,
          limit: req.query.limit,
          terms: useV4 ? null : IT_FEED_TERMS,
          industryFilter: useV4 ? 'it-v4' : null,
        });
        return success(res, result, req);
      }
      const requested = req.query.channel;
      const channelId = requested === undefined || requested === null || requested === ''
        ? resolveDefaultChannelId(tenant)
        : requested;
      if (!channelId) {
        throw Object.assign(new Error('This workspace is not entitled to that news source'), {
          code: 'CHANNEL_NOT_ENTITLED',
          statusCode: 403,
        });
      }
      requireChannel(channelId);
      assertChannelAllowed(tenant, channelId);
      const result = await getNewsFeedService().listFeed({
        channelId,
        cursor: req.query.cursor,
        limit: req.query.limit,
      });
      return success(res, result, req);
    } catch (error) {
      throw normalizeNewsFeedError(error);
    }
  }));

  router.use((error, req, res, _next) => sendError(res, req, error));
  return router;
}

function scopedCompany(req, companyId) {
  if (companyId !== req.authContext.companyId) {
    throw Object.assign(new Error('Company scope does not match authenticated context'), {
      code: 'SCOPE_CONTEXT_UNTRUSTED',
      statusCode: 403,
    });
  }
  return companyId;
}

function normalizeNewsFeedError(error) {
  if (error instanceof UnknownChannelError) {
    return Object.assign(error, { statusCode: error.statusCode || 400 });
  }
  if (error instanceof InvalidCrawlCursorError || error instanceof InvalidCrawlChannelError) {
    return Object.assign(error, { statusCode: 400 });
  }
  if (error?.code === 'INVALID_CRAWL_LIMIT') {
    return Object.assign(error, { code: 'VALIDATION_ERROR', statusCode: 400 });
  }
  if (error instanceof CrawlSourceUnavailableError || error?.code === 'CRAWL_SOURCE_UNAVAILABLE') {
    return Object.assign(error, { statusCode: 503 });
  }
  return error;
}

function isMixedView(value) {
  return value === 'mixed';
}

function success(res, data, req) {
  return res.status(200).json({
    success: true,
    data,
    meta: {
      request_id: getRequestId(req),
      correlation_id: getCorrelationId(req),
    },
  });
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { createNewsFeedRouter };
