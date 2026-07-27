'use strict';

const DEFAULT_CHANNEL_ID = 'egi_media';

const CHANNELS = Object.freeze([
  channel('viral', 'Viral', 'viral_x', 'text', false),
  channel('egi_media', 'EGI Media', 'cms', 'card', true),
  crawlChannel('detik', 'Detik'),
  crawlChannel('viva', 'VIVA'),
  crawlChannel('suara', 'Suara'),
  crawlChannel('cnn_indonesia', 'CNN Indonesia'),
  crawlChannel('liputan6', 'Liputan6'),
  crawlChannel('tirto', 'Tirto'),
  crawlChannel('tempo', 'Tempo'),
  crawlChannel('kumparan', 'Kumparan'),
  crawlChannel('jawa_pos', 'Jawa Pos'),
  crawlChannel('okezone', 'Okezone'),
  crawlChannel('sindonews', 'SINDOnews'),
  crawlChannel('idn_times', 'IDN Times'),
  crawlChannel('republika', 'Republika'),
  crawlChannel('media_indonesia', 'Media Indonesia'),
  crawlChannel('merdeka', 'Merdeka'),
  crawlChannel('beritasatu', 'BeritaSatu'),
  crawlChannel('tribunnews', 'Tribunnews'),
]);

const CHANNEL_BY_ID = new Map(CHANNELS.map((entry) => [entry.id, entry]));
const CRAWL_SOURCE_IDS = Object.freeze(
  CHANNELS.filter((entry) => entry.provider === 'crawl').map((entry) => entry.crawl_source_id)
);

class UnknownChannelError extends Error {
  constructor(channelId) {
    super(`Unknown news feed channel: ${String(channelId)}`);
    this.name = 'UnknownChannelError';
    this.code = 'UNKNOWN_NEWS_FEED_CHANNEL';
    this.channelId = channelId;
  }
}

function channel(id, label, provider, layout, feedsIssues, crawlSourceId = null) {
  return Object.freeze({
    id,
    label,
    provider,
    layout,
    feeds_issues: feedsIssues,
    crawl_source_id: crawlSourceId,
  });
}

function crawlChannel(id, label) {
  return channel(id, label, 'crawl', 'card', true, id);
}

function listChannels() {
  return CHANNELS;
}

function getChannel(channelId) {
  return CHANNEL_BY_ID.get(channelId) || null;
}

function requireChannel(channelId) {
  const entry = getChannel(channelId);
  if (!entry) throw new UnknownChannelError(channelId);
  return entry;
}

module.exports = {
  CHANNELS,
  CRAWL_SOURCE_IDS,
  DEFAULT_CHANNEL_ID,
  UnknownChannelError,
  getChannel,
  listChannels,
  requireChannel,
};
