const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(api.?key|secret|password|token|authorization|cookie|app.?password|private.?key|credential|prompt|source.?text|company.?context|recipient|subject|content|raw.?body|access.?token|refresh.?token)/i;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 50;

function sanitizeString(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r?\n/g, "\\n")
    .slice(0, MAX_STRING_LENGTH);
}

function hashValue(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

function safeValue(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value instanceof Error) return safeError(value);
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => safeValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, MAX_ARRAY_ITEMS).map(([k, v]) => [k, safeValue(v, k)]));
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "bigint") return value.toString();
  return value;
}

function safeError(error, { includeMessage = true } = {}) {
  if (!error) return null;
  const result = {
    name: sanitizeString(error.name || "Error"),
    code: sanitizeString(error.code || "UNKNOWN_ERROR"),
    status: error.status || error.statusCode || null,
    retryable: Boolean(error.retryable),
    details: safeValue(error.details || {}, "details"),
  };
  if (includeMessage) result.message = sanitizeString(error.message || "");
  return result;
}

function createLogger({ service = "egi-media-ai-backend", env = process.env.APP_ENV || "development", stream = null, filePath = process.env.LOG_FILE_PATH || null, maxBytes = Number(process.env.LOG_MAX_BYTES || 10 * 1024 * 1024), base = {} } = {}) {
  const output = stream || (filePath ? createRotatingFileStream(filePath, maxBytes) : process.stdout);
  function write(level, message, fields = {}) {
    const entry = { timestamp: new Date().toISOString(), level, service, environment: env, event: message, ...safeValue(base), ...safeValue(fields) };
    const line = `${JSON.stringify(entry)}\n`;
    if (typeof output.write === "function") output.write(line);
    else if (typeof output[level] === "function") output[level](line.trim());
    else if (typeof output.log === "function") output.log(line.trim());
  }
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    fatal: (m, f) => write("fatal", m, f),
    child: (fields = {}) => createLogger({ service, env, stream: output, base: { ...base, ...fields } }),
  };
}

function createRotatingFileStream(filePath, maxBytes) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  return {
    write(line) {
      try {
        const currentSize = fs.existsSync(absolutePath) ? fs.statSync(absolutePath).size : 0;
        if (currentSize + Buffer.byteLength(line) > maxBytes) {
          const rotated = `${absolutePath}.${new Date().toISOString().replace(/[:.]/g, "-")}`;
          if (fs.existsSync(absolutePath)) fs.renameSync(absolutePath, rotated);
        }
        fs.appendFileSync(absolutePath, line, "utf8");
      } catch { /* logging must never change application behavior */ }
    },
  };
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
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    logger.info("http_request_started", { requestId: req.requestId, correlationId: req.correlationId, traceId: req.traceId, method: req.method, path: req.path });
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const route = req.route?.path || req.path || "unknown";
      const labels = { method: req.method, route, status: String(res.statusCode) };
      metrics.increment("http_requests_total", labels);
      metrics.observe("http_request_duration_ms", { method: req.method, route }, Number(durationMs.toFixed(3)));
      logger[res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"]("http_request_completed", { requestId: req.requestId, correlationId: req.correlationId, traceId: req.traceId, actorType: req.authContext?.actor?.actorType || null, tenantId: req.authContext?.tenantId || null, companyId: req.authContext?.companyId || null, ...labels, durationMs: Number(durationMs.toFixed(3)), errorCode: res.locals.errorCode || null });
    });
    next();
  };
}

module.exports = { createLogger, createRotatingFileStream, MetricsRegistry, observabilityMiddleware, safeValue, safeError, hashValue, REDACTED };
