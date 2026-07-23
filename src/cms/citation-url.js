const { CmsSourceConfigurationError } = require("./cms-source.errors");

const SUPPORTED_LOCALES = Object.freeze(["id", "en", "uz"]);

function assertSupportedLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new CmsSourceConfigurationError("Article locale is not supported", { details: { locale } });
  }
}

function buildCanonicalArticleUrl({ portalBaseUrl, locale, articleId }) {
  assertSupportedLocale(locale);
  if (!articleId || typeof articleId !== "string") {
    throw new CmsSourceConfigurationError("Article ID is required for citation URL");
  }
  let url;
  try {
    url = new URL(portalBaseUrl);
  } catch (_error) {
    throw new CmsSourceConfigurationError("PORTAL_BASE_URL must be a valid URL");
  }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) {
    throw new CmsSourceConfigurationError("PORTAL_BASE_URL must be an HTTP(S) URL without credentials");
  }
  const basePath = url.pathname.replace(/\/$/, "");
  url.pathname = `${basePath}/${locale}/articles/${encodeURIComponent(articleId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

module.exports = { SUPPORTED_LOCALES, assertSupportedLocale, buildCanonicalArticleUrl };
