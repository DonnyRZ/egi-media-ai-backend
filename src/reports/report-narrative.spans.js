function resolveConstrainedSpan(narrative, allowedSpanId) {
  if (!narrative || typeof narrative !== "object" || typeof allowedSpanId !== "string") return null;
  if (allowedSpanId.startsWith("issue_section:")) {
    const [, reportItemId, field] = allowedSpanId.split(":");
    const index = narrative.issueSections?.findIndex((item) => item.reportItemId === reportItemId) ?? -1;
    if (index < 0 || !["whatHappened", "whyImportant", "impact", "risk", "watch"].includes(field)) return null;
    const item = narrative.issueSections[index];
    const values = Array.isArray(item[field]) ? item[field] : [];
    return toSpan({ spanId: allowedSpanId, kind: "issue_section", index, field, value: { narrative: values[0], sourceClaimIds: item.sourceClaimIds } });
  }
  if (allowedSpanId.startsWith("issue_narrative:")) {
    const reportItemId = allowedSpanId.slice("issue_narrative:".length);
    const index = narrative.issueNarratives?.findIndex((item) => item.reportItemId === reportItemId) ?? -1;
    return index < 0 ? null : toSpan({ spanId: allowedSpanId, kind: "issue_narrative", index, value: narrative.issueNarratives[index] });
  }
  if (allowedSpanId === "impact_narrative") return toSpan({ spanId: allowedSpanId, kind: "impact_narrative", value: narrative.impactNarrative });
  if (allowedSpanId.startsWith("watch_item:")) {
    const index = Number(allowedSpanId.slice("watch_item:".length));
    if (!Number.isInteger(index) || index < 0 || index >= (narrative.watchItems?.length ?? 0)) return null;
    return toSpan({ spanId: allowedSpanId, kind: "watch_item", index, value: narrative.watchItems[index] });
  }
  return null;
}

function replaceConstrainedSpan(narrative, span, replacementText) {
  const rewritten = structuredClone(narrative);
  if (span.kind === "issue_section") rewritten.issueSections[span.index][span.field] = [replacementText];
  else if (span.kind === "issue_narrative") rewritten.issueNarratives[span.index].narrative = replacementText;
  else if (span.kind === "impact_narrative") rewritten.impactNarrative.narrative = replacementText;
  else if (span.kind === "watch_item") rewritten.watchItems[span.index].narrative = replacementText;
  else return null;
  return rewritten;
}

function toSpan({ spanId, kind, index = null, value }) {
  if (!value || typeof value.narrative !== "string" || !value.narrative.trim() || !Array.isArray(value.sourceClaimIds) || value.sourceClaimIds.length < 1) return null;
  const sourceClaimIds = [...value.sourceClaimIds];
  if (sourceClaimIds.some((id) => typeof id !== "string" || !id) || new Set(sourceClaimIds).size !== sourceClaimIds.length) return null;
  return { spanId, kind, index, text: value.narrative, sourceClaimIds };
}

module.exports = { resolveConstrainedSpan, replaceConstrainedSpan };
