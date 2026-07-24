const fs = require("fs");
const path = require("path");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i].startsWith("--")) args.set(process.argv[i].slice(2), process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : "true");
}

const file = path.resolve(args.get("file") || "logs/dev.out.log");
if (!fs.existsSync(file)) {
  process.stderr.write(`Log file not found: ${file}\n`);
  process.exitCode = 1;
} else {
  const limit = Number(args.get("limit") || 100);
  const wanted = ["request-id", "correlation-id", "tenant-id", "company-id", "task", "error-code", "event"];
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(parseLine).filter(Boolean).filter((row) => wanted.every((key) => !args.has(key) || String(row[key.replaceAll("-", "_")] || row[key]) === args.get(key))).slice(-limit);
  for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
}

function parseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}
