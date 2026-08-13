"use strict";

const { DEFAULT_CHANNEL_ID, listChannels } = require("../news-feed/channel-registry");

const METADATA_KEY = "allowed_news_channel_ids";

function visibleChannels() {
  return listChannels().filter((channel) => channel.id !== "viral");
}

function visibleChannelIds() {
  return visibleChannels().map((channel) => channel.id);
}

function validationError(message) {
  return Object.assign(new Error(message), { code: "VALIDATION_ERROR", statusCode: 400 });
}

function channelNotEntitled(channelId) {
  return Object.assign(new Error("This workspace is not entitled to that news source"), {
    code: "CHANNEL_NOT_ENTITLED",
    statusCode: 403,
    details: { channelId },
  });
}

function parseAllowedChannelIds(value) {
  if (!Array.isArray(value)) throw validationError("allowed_news_channel_ids must be an array of channel ids");
  const visible = new Set(visibleChannelIds());
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) throw validationError("Each news source id must be a non-empty string");
    const id = item.trim();
    if (id === "viral" || !visible.has(id)) throw validationError(`Unknown or unavailable news source: ${id}`);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) throw validationError("Select at least one news source");
  return ids;
}

function storedAllowedChannelIds(tenant) {
  const stored = tenant?.metadata?.[METADATA_KEY];
  return Array.isArray(stored) ? stored : null;
}

function getAllowedChannelIds(tenant) {
  const stored = storedAllowedChannelIds(tenant);
  if (!stored || !stored.length) return visibleChannelIds();
  const visible = new Set(visibleChannelIds());
  return stored.filter((id) => visible.has(id));
}

function isChannelAllowed(tenant, channelId) {
  return getAllowedChannelIds(tenant).includes(channelId);
}

function assertChannelAllowed(tenant, channelId) {
  if (!tenant) return;
  if (!isChannelAllowed(tenant, channelId)) throw channelNotEntitled(channelId);
}

function resolveDefaultChannelId(tenant) {
  const allowed = getAllowedChannelIds(tenant);
  if (allowed.includes(DEFAULT_CHANNEL_ID)) return DEFAULT_CHANNEL_ID;
  return allowed[0] || null;
}

function listEntitledChannels(tenant) {
  const allowed = new Set(getAllowedChannelIds(tenant));
  return visibleChannels()
    .filter((channel) => allowed.has(channel.id))
    .map((channel) => ({
      id: channel.id,
      label: channel.label,
      layout: channel.layout,
      provider: channel.provider,
    }));
}

function mergeAllowedNewsChannels(currentMetadata, bodyMetadata, allowedNewsChannelIds) {
  const hasBodyMetadata = bodyMetadata !== undefined;
  const hasAllowed = allowedNewsChannelIds !== undefined;
  if (!hasBodyMetadata && !hasAllowed) return undefined;
  const metadata = {
    ...(currentMetadata && typeof currentMetadata === "object" ? currentMetadata : {}),
    ...(hasBodyMetadata && bodyMetadata && typeof bodyMetadata === "object" && !Array.isArray(bodyMetadata) ? bodyMetadata : {}),
  };
  if (hasAllowed) metadata[METADATA_KEY] = parseAllowedChannelIds(allowedNewsChannelIds);
  return metadata;
}

async function loadTenant(getTenantStore, tenantId) {
  if (typeof getTenantStore !== "function" || !tenantId) return null;
  return getTenantStore().get({ tenantId });
}

module.exports = {
  METADATA_KEY,
  visibleChannels,
  visibleChannelIds,
  parseAllowedChannelIds,
  getAllowedChannelIds,
  isChannelAllowed,
  assertChannelAllowed,
  resolveDefaultChannelId,
  listEntitledChannels,
  mergeAllowedNewsChannels,
  loadTenant,
};
