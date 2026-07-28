const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assessArticleContent,
  MIN_CLEAN_CONTENT_CHARS,
  cleanText,
} = require("../src/ingest/content-quality-gate");

test("content quality gate accepts substantial clean article bodies", () => {
  const body = "A".repeat(MIN_CLEAN_CONTENT_CHARS);
  const result = assessArticleContent({
    title: "Hotel occupancy recovers in Bali",
    summary: "Hospitality operators report stronger weekend demand.",
    content: `${body} Additional operating context for guests and investors.`,
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
  assert.ok(result.details.contentLength >= MIN_CLEAN_CONTENT_CHARS);
});

test("content quality gate skips empty, title-like, thin, and placeholder bodies", () => {
  assert.equal(assessArticleContent({ title: "X", content: null }).reason, "content_empty");
  assert.equal(assessArticleContent({ title: "AMPI Lantik Sekjen Baru", content: "AMPI Lantik Sekjen Baru" }).reason, "title_equals_body");
  assert.equal(assessArticleContent({
    title: "Internal AMPI Soroti Pelantikan Sekjen Baru",
    content: "AMPI Lantik Sekjen Baru",
  }).reason, "content_too_thin");
  assert.equal(assessArticleContent({
    title: "Coming soon page",
    content: `${"Word ".repeat(100)} coming soon for subscribers`,
  }).reason, "placeholder_content");
});

test("content quality gate measures clean text after stripping HTML noise", () => {
  const html = `<div><script>evil()</script><p>${"Hotel ".repeat(90)}</p></div>`;
  const result = assessArticleContent({ title: "Hotel promo", content: html });
  assert.equal(result.ok, true);
  assert.equal(cleanText(html).includes("evil"), false);
  assert.ok(result.details.contentLength >= MIN_CLEAN_CONTENT_CHARS);
});
