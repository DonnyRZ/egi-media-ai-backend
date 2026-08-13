const { createHash, randomUUID } = require("crypto");
class InMemorySourceSnapshotStore {
  constructor({ uuid = randomUUID, now = Date.now } = {}) { this.uuid = uuid; this.now = now; this.snapshotsByKey = new Map(); }
  upsert({ sourceArticleId, locale, canonicalUrl, article, observedAt = this.now() }) {
    const fingerprint = fingerprintOf({ sourceArticleId, locale, canonicalUrl, article }); const key = `${sourceArticleId}|${locale}|${fingerprint}`; const existing = this.snapshotsByKey.get(key);
    if (existing) return { snapshot: clone(existing), reused: true };
    const value = { snapshotId: this.uuid(), sourceArticleId, locale, canonicalUrl, fingerprint, article: structuredClone(article), publishedAt: article.publishedAt, sourceUpdatedAt: article.updatedAt || article.publishedAt, observedAt: new Date(observedAt).toISOString(), createdAt: new Date(this.now()).toISOString() };
    this.snapshotsByKey.set(key, value); return { snapshot: clone(value), reused: false };
  }
  get({ sourceArticleId, locale }) { const values = [...this.snapshotsByKey.values()].filter((value) => value.sourceArticleId === sourceArticleId && value.locale === locale).sort((a, b) => Date.parse(b.sourceUpdatedAt) - Date.parse(a.sourceUpdatedAt)); return values[0] ? clone(values[0]) : null; }
  getById({ snapshotId }) { const value = [...this.snapshotsByKey.values()].find((item) => item.snapshotId === snapshotId); return value ? clone(value) : null; }
  list() { return [...this.snapshotsByKey.values()].map(clone); }
}
function fingerprintOf(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function clone(value) { return structuredClone(value); }
module.exports = { InMemorySourceSnapshotStore, fingerprintOf };
