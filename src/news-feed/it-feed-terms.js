"use strict";

/**
 * Conservative lexical gate for the ACME-IT demo feed.
 * Used only until the frozen IT v4 joblib can score crawl rows locally.
 * Do not treat these terms as a replacement for v4 thresholds.
 */
const IT_FEED_TERMS = Object.freeze([
  "cybersecurity",
  "cyber security",
  "keamanan siber",
  "serangan siber",
  "ransomware",
  "malware",
  "data center",
  "pusat data",
  "kecerdasan buatan",
  "artificial intelligence",
  "machine learning",
  "semiconductor",
  "cloud computing",
  "komputasi awan",
  "software",
  "saas",
  "infrastruktur it",
  "teknologi informasi",
  "chip",
  "server",
  "siber",
]);

module.exports = { IT_FEED_TERMS };
