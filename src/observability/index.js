const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(key|secret|password|token|authorization|cookie|appPassword)/i;

function safeValue(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => safeValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safeValue(v, k)]));
  return value;
}

function createLogger({ service = "egi-media-ai-backend", env = process.env.APP_ENV || "development", stream = console } = {}) {
  function write(level, message, fields = {}) {
    const entry = { timestamp: new Date().toISOString(), level, service, env, message, ...safeValue(fields) };
    const writer = stream[level] || stream.log || console.log;
    writer.call(stream, JSON.stringify(entry));
  }
  return { debug: (m, f) => write("debug", m, f), info: (m, f) => write("info", m, f), warn: (m, f) => write("warn", m, f), error: (m, f) => write("error", m, f) };
}

class MetricsRegistry {
  constructor() { this.reset(); }
  reset() { this.counters = new Map(); this.histograms = new Map(); }
  increment(name, labels = {}, value = 1) { const key = `${name}|${JSON.stringify(labels)}`; this.counters.set(key, { name, labels, value: (this.counters.get(key)?.value || 0) + value }); }
  observe(name, labels = {}, value) { const key = `${name}|${JSON.stringify(labels)}`; const item = this.histograms.get(key) || { name, labels, count: 0, sum: 0, max: 0 }; item.count += 1; item.sum += value; item.max = Math.max(item.max, value); this.histograms.set(key, item); }
  snapshot() { return { counters: [...this.counters.values()], histograms: [...this.histograms.values()] }; }
  toPrometheus() { const lines = []; for (const item of this.counters.values()) lines.push(`${item.name}${formatLabels(item.labels)} ${item.value}`); for (const item of this.histograms.values()) { lines.push(`${item.name}_count${formatLabels(item.labels)} ${item.count}`); lines.push(`${item.name}_sum${formatLabels(item.labels)} ${item.sum}`); lines.push(`${item.name}_max${formatLabels(item.labels)} ${item.max}`); } return `${lines.join("\n")}\n`; }
}

function formatLabels(labels) { const entries = Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`); return entries.length ? `{${entries.join(",")}}` : ""; }

function observabilityMiddleware({ logger, metrics }) {
  return (req, res, next) => { const startedAt = process.hrtime.bigint(); res.on("finish", () => { const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6; const route = req.route?.path || req.path || "unknown"; const labels = { method: req.method, route, status: String(res.statusCode) }; metrics.increment("http_requests_total", labels); metrics.observe("http_request_duration_ms", { method: req.method, route }, Number(durationMs.toFixed(3))); logger.info("http_request_completed", { requestId: req.requestId, correlationId: req.correlationId, traceId: req.traceId, ...labels, durationMs: Number(durationMs.toFixed(3)) }); }); next(); };
}

module.exports = { createLogger, MetricsRegistry, observabilityMiddleware, safeValue, REDACTED };
