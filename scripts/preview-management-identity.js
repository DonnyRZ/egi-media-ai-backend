"use strict";

/**
 * @deprecated Use generate-management-identity.js (Luna drafts identity from context).
 * Kept as a pointer so old npm script invocations fail with a clear message.
 */
console.error([
  "preview-management-identity.js was removed.",
  "Identity is now drafted by Luna from company context fields.",
  "",
  "Use:",
  "  npm run identity:generate -- path/to/your-context-fields.json",
  "  node scripts/generate-management-identity.js <context-fields.json> [--out out.json]",
].join("\n"));
process.exit(1);
