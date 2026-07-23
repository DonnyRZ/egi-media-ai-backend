const { randomUUID } = require("crypto");

function validHeaderId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\r\n]/.test(value);
}

function requestContextMiddleware(req, res, next) {
  const requestId = validHeaderId(req.get("X-Request-Id")) ? req.get("X-Request-Id") : randomUUID();
  const correlationId = validHeaderId(req.get("X-Correlation-Id"))
    ? req.get("X-Correlation-Id")
    : requestId;
  const traceId = validHeaderId(req.get("X-Trace-Id")) ? req.get("X-Trace-Id") : correlationId;

  req.requestId = requestId;
  req.correlationId = correlationId;
  req.traceId = traceId;
  res.set("X-Request-Id", requestId);
  res.set("X-Correlation-Id", correlationId);
  res.set("X-Trace-Id", traceId);
  return next();
}

function getRequestId(req) { return req?.requestId || null; }
function getCorrelationId(req) { return req?.correlationId || req?.requestId || null; }

module.exports = { requestContextMiddleware, getRequestId, getCorrelationId };
