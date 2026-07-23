class InMemoryWatermarkStore {
  constructor({ now = Date.now } = {}) { this.now = now; this.values = new Map(); }
  get({ sourceName, locale }) { const value = this.values.get(`${sourceName}|${locale}`); return value ? structuredClone(value) : null; }
  set({ sourceName, locale, watermark, cursor = null }) { const value = { sourceName, locale, watermark, cursor, updatedAt: new Date(this.now()).toISOString() }; this.values.set(`${sourceName}|${locale}`, value); return structuredClone(value); }
}
module.exports = { InMemoryWatermarkStore };
