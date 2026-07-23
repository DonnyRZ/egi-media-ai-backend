const { CmsSourceConfigurationError, CmsSourceError } = require("./cms-source.errors");

class CmsArticleClient {
  constructor({ baseUrl, timeoutMs, fetchFn = fetch }) {
    this.baseUrl = normalizeBaseUrl(baseUrl, "CMS_BASE_URL");
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new CmsSourceConfigurationError("CMS_TIMEOUT_MS must be a positive integer");
    }
    if (typeof fetchFn !== "function") {
      throw new CmsSourceConfigurationError("CMS client requires a fetch implementation");
    }
    this.timeoutMs = timeoutMs;
    this.fetchFn = fetchFn;
  }

  async getArticleById({ articleId, locale }) {
    const url = new URL(`/api/v1/articles/${encodeURIComponent(articleId)}`, this.baseUrl);
    url.searchParams.set("lang", locale);

    let response;
    try {
      response = await this.fetchFn(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new CmsSourceError(isTimeout ? "CMS article request timed out" : "CMS article request failed", {
        code: isTimeout ? "CMS_SOURCE_TIMEOUT" : "CMS_SOURCE_UNAVAILABLE",
        retryable: true,
        cause: error,
      });
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new CmsSourceError("CMS article request was rejected", {
        code: "CMS_SOURCE_REJECTED",
        retryable: response.status >= 500 || response.status === 429,
        details: { status: response.status },
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new CmsSourceError("CMS article response was not valid JSON", {
        code: "CMS_SOURCE_MALFORMED_RESPONSE",
        cause: error,
      });
    }
    if (payload?.success !== true || !payload.data || typeof payload.data !== "object") return null;
    return payload.data;
  }
}

function normalizeBaseUrl(value, variableName) {
  try {
    const url = new URL(value);
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) throw new Error("unsupported URL");
    return url;
  } catch (_error) {
    throw new CmsSourceConfigurationError(`${variableName} must be an HTTP(S) URL without credentials`);
  }
}

module.exports = { CmsArticleClient, normalizeBaseUrl };
