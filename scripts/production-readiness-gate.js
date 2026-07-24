const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { validateProductionEnvironment } = require("../src/config/environment");

const root = path.join(__dirname, "..");
for (const file of ["Dockerfile", ".dockerignore", ".env.production.example", "swagger_output.json"]) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing production artifact: ${file}`);
const validEnv = { APP_ENV: "production", APP_HOST: "0.0.0.0", APP_PORT: "5003", CORS_ORIGINS: "https://portal.example.com", CMS_BASE_URL: "https://cms.example.com", PORTAL_BASE_URL: "https://portal.example.com", AUTH_ACCESS_TOKEN_SECRET: "x".repeat(40), OPENAI_API_KEY: "sk-test", OPENAI_MINI_MODEL: "mini", OPENAI_NANO_MODEL: "nano", SOURCE_DATABASE_URL: "postgresql://source:secret@db:5432/main", AI_DATABASE_URL: "postgresql://ai:secret@db:5432/ai", EMAIL_TRANSPORT: "smtp", EMAIL_SMTP_HOST: "smtp.gmail.com", EMAIL_SMTP_USER: "egi.egiholding@gmail.com", EMAIL_SMTP_APP_PASSWORD: "test-app-password", EMAIL_FROM_ADDRESS: "egi.egiholding@gmail.com" };
validateProductionEnvironment(validEnv);
try { validateProductionEnvironment({ ...validEnv, AUTH_ACCESS_TOKEN_SECRET: "short" }); throw new Error("Weak production secret was accepted"); } catch (error) { if (error.message === "Weak production secret was accepted") throw error; }
JSON.parse(fs.readFileSync(path.join(root, "swagger_output.json"), "utf8"));
const testFiles = [
  ...fs.readdirSync(path.join(root, "test")).filter((file) => file.endsWith(".test.js")).map((file) => path.join("test", file)),
  ...fs.readdirSync(path.join(root, "test", "integration")).filter((file) => file.endsWith(".test.js")).map((file) => path.join("test", "integration", file)),
];
const result = spawnSync(process.execPath, ["--test", ...testFiles], { cwd: root, stdio: "inherit" });
if (result.error || result.status !== 0) process.exit(result.status || 1);
console.log("S30 production readiness gate passed: artifacts, env validation, tests, and Swagger.");
