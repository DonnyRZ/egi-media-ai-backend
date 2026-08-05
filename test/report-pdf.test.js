const assert = require("node:assert/strict");
const test = require("node:test");
const { createReportPdf } = require("../src/reports/report-pdf");

test("report PDF export produces a valid PDF from a validated narrative", async () => {
  const pdf = await createReportPdf({
    report: { reportType: "mingguan", periodStart: "2026-01-01", periodEnd: "2026-01-08", reportId: "report-test" },
    narrative: { executive_summary: "Summary", issue_narratives: [{ report_item_id: "item-1", narrative: "Issue narrative" }], impact_narrative: { narrative: "Impact" }, watch_items: [{ narrative: "Watch" }], source_references: [{ claim_id: "claim-1", source_article_id: "article-1" }] },
  });
  assert.equal(Buffer.isBuffer(pdf), true);
  assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.3");
  assert.equal(pdf.length > 1000, true);
});
