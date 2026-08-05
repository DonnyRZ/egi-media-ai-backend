const PDFDocument = require("pdfkit");

function createReportPdf({ report, narrative }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `EGI Media ${report.reportType} report`, Author: "EGI Media AI" } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const text = (value) => Array.isArray(value) ? value.join("\n") : value == null ? "" : String(value);
    const heading = (label, level = 1) => { doc.moveDown(level === 1 ? 0.7 : 0.35).font(level === 1 ? "Helvetica-Bold" : "Helvetica-Bold").fontSize(level === 1 ? 15 : 11).fillColor("#111827").text(label); doc.font("Helvetica").fontSize(10).fillColor("#374151"); };
    const bullets = (items) => (Array.isArray(items) ? items : []).forEach((item) => doc.text(`• ${text(item)}`, { indent: 10, paragraphGap: 4 }));
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#111827").text("EGI Media");
    doc.font("Helvetica").fontSize(10).fillColor("#6B7280").text(`${String(report.reportType).toUpperCase()} REPORT  •  ${report.periodStart} — ${report.periodEnd}`);
    heading("Executive summary"); bullets(narrative.executiveSummary || narrative.executive_summary);
    const overview = narrative.overview || [];
    if (overview.length) { heading("Overview"); bullets(overview.map((item) => item.text || item.narrative || item)); }
    const issues = narrative.issueSections || narrative.issue_narratives || [];
    if (issues.length) { heading(report.reportType === "harian" ? "Most important issues today" : "Main developments"); issues.forEach((issue, index) => { heading(`${index + 1}. ${issue.title || issue.reportItemId || issue.report_item_id || "Issue"}`, 2); doc.text(text(issue.narrative || issue.whatHappened || issue.what_happened)); if (issue.whyImportant || issue.why_important) doc.text(`Why it matters: ${text(issue.whyImportant || issue.why_important)}`); if (issue.impact) doc.text(`Impact: ${text(issue.impact)}`); if (issue.risk) doc.text(`Risk: ${text(issue.risk)}`); if (issue.watch) doc.text(`Watch: ${text(issue.watch)}`); }); }
    const categories = narrative.categoryDevelopments || narrative.category_developments || [];
    if (categories.length) { heading("Developments by category"); categories.forEach((item) => { heading(item.category || item.title || "Category", 2); bullets([...(item.points || []), ...(item.impact || []).map((value) => `Impact: ${value}`)]); }); }
    const comparison = narrative.comparison;
    if (comparison) { heading(comparison.label || "Comparison"); bullets([...(comparison.newItems || comparison.new_items || []).map((value) => `New: ${value}`), ...(comparison.worsened || []).map((value) => `Worsened: ${value}`), ...(comparison.improved || []).map((value) => `Improved: ${value}`), ...(comparison.priorityShifts || comparison.priority_shifts || []).map((value) => `Priority shift: ${value}`)]); }
    const sections = [["Trends", narrative.trends], ["Company impact", narrative.companyImpacts || narrative.company_impacts], ["Risks and opportunities", narrative.riskOpportunity || narrative.risk_opportunity || narrative.risks || narrative.opportunities], ["Watch items", narrative.watchItems || narrative.watch_items], ["Follow-up options", narrative.followUpOptions || narrative.follow_up_options]];
    sections.forEach(([label, items]) => { if (Array.isArray(items) && items.length) { heading(label); bullets(items.map((item) => item.text || item.narrative || item.title || item)); } });
    if (Array.isArray(narrative.sourceReferences || narrative.source_references) && (narrative.sourceReferences || narrative.source_references).length) { heading("Sources"); bullets((narrative.sourceReferences || narrative.source_references).map((ref) => `${ref.claimId || ref.claim_id} — ${sourceLabel(ref)}`)); }
    doc.end();
  });
}

function sourceLabel(ref) {
  const title = ref.title || ref.articleTitle || ref.article_title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const media = ref.sourceName || ref.source_name || ref.media;
  if (typeof media === "string" && media.trim()) return media.trim();
  const id = ref.sourceArticleId || ref.source_article_id;
  const provider = typeof id === "string" ? /^crawl:([^:]+):/i.exec(id)?.[1] : null;
  return provider ? provider.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Source article";
}

module.exports = { createReportPdf };
