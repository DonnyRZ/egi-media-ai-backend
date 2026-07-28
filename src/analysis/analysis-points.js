/**
 * Flatten T07 point fields for consumers that still expect a single narrative string
 * (T10 prompts, T13 report pack validation, legacy report items).
 * Accepts v2 string[] points or legacy single strings.
 */
function flattenAnalysisPoints(value, { separator = " " } = {}) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim())
      .join(separator);
  }
  if (typeof value === "string") return value.trim();
  return "";
}

module.exports = { flattenAnalysisPoints };
