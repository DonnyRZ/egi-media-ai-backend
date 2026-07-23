const TEMPLATE_VERSION = "direct-alert-v1";

function renderDirectAlertTemplate({ issue, blurb, detailUrl }) {
  const subject = `[EGI Media] Prioritas tinggi: ${issue.title}`;
  const text = [
    `Isu: ${issue.title}`,
    `Prioritas: ${issue.currentPriority}`,
    `Ringkasan: ${issue.oneLiner}`,
    "",
    blurb.newDevelopmentBlurb,
    blurb.shortImpactBlurb,
    "",
    `Detail: ${detailUrl}`,
  ].join("\n");
  const html = `<h2>${escapeHtml(issue.title)}</h2><p><strong>Prioritas:</strong> ${escapeHtml(issue.currentPriority)}</p><p>${escapeHtml(issue.oneLiner)}</p><p>${escapeHtml(blurb.newDevelopmentBlurb)}</p><p>${escapeHtml(blurb.shortImpactBlurb)}</p><p><a href="${escapeAttribute(detailUrl)}">Lihat detail isu</a></p>`;
  return { templateVersion: TEMPLATE_VERSION, subject, text, html };
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function escapeAttribute(value) { return escapeHtml(value); }
module.exports = { TEMPLATE_VERSION, renderDirectAlertTemplate };
