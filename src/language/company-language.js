const SUPPORTED_LANGUAGES = Object.freeze(["id", "en"]);
const DEFAULT_LANGUAGE = "id";

function isSupportedLanguage(value) {
  return SUPPORTED_LANGUAGES.includes(value);
}

function resolveCompanyLanguage(localeOrPreference) {
  return isSupportedLanguage(localeOrPreference) ? localeOrPreference : DEFAULT_LANGUAGE;
}

function normalizeLanguagePreference(value) {
  if (!isSupportedLanguage(value)) {
    throw Object.assign(new Error("language must be id or en"), { code: "VALIDATION_ERROR", statusCode: 400 });
  }
  return value;
}

module.exports = {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  resolveCompanyLanguage,
  normalizeLanguagePreference,
};
