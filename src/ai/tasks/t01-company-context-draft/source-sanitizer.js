const { createHash } = require("crypto");

const SOURCE_TYPES = Object.freeze(["url", "file", "paste"]);
const SOURCE_LOCATOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

class T01InputError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "T01InputError";
    this.code = "T01_INPUT_INVALID";
    this.details = details;
  }
}

function sanitizeSources({ sources, limits }) {
  const normalizedLimits = normalizeLimits(limits);
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > normalizedLimits.maxSources) {
    throw new T01InputError("T01 requires at least one source within the configured source limit");
  }

  const seenLocators = new Set();
  let totalCharacters = 0;
  const sanitized = sources.map((source) => {
    validateSourceMetadata(source);
    if (seenLocators.has(source.sourceLocator)) {
      throw new T01InputError("Source locators must be unique", { sourceLocator: source.sourceLocator });
    }
    seenLocators.add(source.sourceLocator);

    const text = sanitizeText(source.text);
    if (!text) {
      throw new T01InputError("Source text is empty after sanitization", { sourceLocator: source.sourceLocator });
    }
    if (text.length > normalizedLimits.maxCharsPerSource) {
      throw new T01InputError("Source text exceeds the configured per-source limit", {
        sourceLocator: source.sourceLocator,
      });
    }

    totalCharacters += text.length;
    if (totalCharacters > normalizedLimits.maxTotalChars) {
      throw new T01InputError("Combined source text exceeds the configured total limit");
    }

    return Object.freeze({
      sourceLocator: source.sourceLocator,
      sourceType: source.sourceType,
      text,
      metadata: source.metadata && typeof source.metadata === "object" ? Object.freeze({ ...source.metadata }) : undefined,
      fingerprint: createHash("sha256").update(text).digest("hex"),
    });
  });

  return Object.freeze(sanitized);
}

function normalizeLimits(limits) {
  if (!limits || typeof limits !== "object") {
    throw new T01InputError("Trusted T01 source limits are required");
  }

  const fields = ["maxSources", "maxCharsPerSource", "maxTotalChars"];
  for (const field of fields) {
    if (!Number.isInteger(limits[field]) || limits[field] <= 0) {
      throw new T01InputError(`Trusted limit ${field} must be a positive integer`);
    }
  }

  if (limits.maxTotalChars < limits.maxCharsPerSource || limits.maxTotalChars > 200000 || limits.maxSources > 50) {
    throw new T01InputError("Trusted source limits exceed technical safety bounds");
  }

  return Object.freeze({ ...limits });
}

function validateSourceMetadata(source) {
  if (!source || typeof source !== "object") {
    throw new T01InputError("Each source must be an object");
  }
  if (!SOURCE_LOCATOR_PATTERN.test(source.sourceLocator || "")) {
    throw new T01InputError("Source locator is invalid", { sourceLocator: source.sourceLocator });
  }
  if (!SOURCE_TYPES.includes(source.sourceType)) {
    throw new T01InputError("Source type is invalid", { sourceType: source.sourceType });
  }
  if (typeof source.text !== "string") {
    throw new T01InputError("Source text must be a string", { sourceLocator: source.sourceLocator });
  }
  if (source.sourceType === "url") {
    if (!source.sourceUrl || typeof source.sourceUrl !== "string") {
      throw new T01InputError("URL source must include a source URL", { sourceLocator: source.sourceLocator });
    }
    let url;
    try {
      url = new URL(source.sourceUrl);
    } catch (_error) {
      throw new T01InputError("URL source has an invalid URL", { sourceLocator: source.sourceLocator });
    }
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) {
      throw new T01InputError("URL source is not allowed", { sourceLocator: source.sourceLocator });
    }
  }
}

function sanitizeText(value) {
  return value
    .normalize("NFC")
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { SOURCE_TYPES, T01InputError, sanitizeSources, sanitizeText };
