const {
  resolveCompanyLanguage,
  normalizeLanguagePreference,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
} = require("./company-language");

const AI_OUTPUT_LANGUAGE_RULE =
  "Write all user-facing prose in output_language from TRUSTED_CONTEXT. Source material may be in a different language; do not mirror the source language unless it matches output_language.";

const PROSE_LANGUAGE_TASKS = Object.freeze(["T01", "T03", "T05", "T06", "T07", "T10", "T12", "T13", "T14"]);
const LANGUAGE_NA_TASKS = Object.freeze(["T02", "T04", "T08", "T09"]); // enums/match — no prose output language

function resolveAiOutputLanguage(preference) {
  return resolveCompanyLanguage(preference);
}

/**
 * Resolve draft extraction/output language from an explicit request body value
 * or the company's stored locale preference. Explicit unsupported values fail
 * closed with VALIDATION_ERROR; missing/unsupported company locale falls back to id.
 */
function resolveDraftLanguage({ explicitLanguage, companyLocale } = {}) {
  if (explicitLanguage != null && explicitLanguage !== "") {
    return normalizeLanguagePreference(explicitLanguage);
  }
  return resolveCompanyLanguage(companyLocale);
}

function applyOutputLanguage(trustedContext, preference) {
  return { ...trustedContext, output_language: resolveAiOutputLanguage(preference) };
}

function outputLanguageContractRule() {
  return AI_OUTPUT_LANGUAGE_RULE;
}

module.exports = {
  AI_OUTPUT_LANGUAGE_RULE,
  PROSE_LANGUAGE_TASKS,
  LANGUAGE_NA_TASKS,
  resolveAiOutputLanguage,
  resolveDraftLanguage,
  applyOutputLanguage,
  outputLanguageContractRule,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
};
