const cors = require("cors");
const config = require("../config/global_config");

const configuredOrigins = config.get("/cors/origins") || "http://localhost:3000";
const allowedOrigins = configuredOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = cors({
  origin: allowedOrigins,
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-Tenant-Id", "X-Company-Id", "X-Request-Id", "X-Correlation-Id", "Idempotency-Key", "If-Match"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});
