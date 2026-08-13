const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const requiredMigrations = ["0009_multi_tenant_lifecycle.sql", "0010_multi_tenant_operability.sql", "0011_scope_unique_keys.sql", "0012_persistent_auth_accounts.sql"];
const requiredDocs = ["Docs/Multi-Tenant-Architecture-Audit.md", "Docs/Tenant-Provisioning-Contract.md", "Docs/Multi-Tenant-Scalability-Readiness.md", "Docs/Seed-and-Bootstrap-Policy.md"];
for (const file of requiredMigrations.concat(requiredDocs)) if (!fs.existsSync(path.join(root, "src/database/migrations", file)) && !fs.existsSync(path.join(root, file))) throw new Error(`Missing multi-tenant artifact: ${file}`);
const swagger = JSON.parse(fs.readFileSync(path.join(root, "swagger_output.json"), "utf8"));
for (const route of ["/api/v1/platform/tenants/{tenantId}", "/api/v1/platform/tenants/{tenantId}/companies", "/api/v1/platform/tenants/{tenantId}/companies/{companyId}", "/api/v1/platform/tenants/{tenantId}/owner", "/api/v1/tenant/companies", "/api/v1/auth/switch-context"]) if (!swagger.paths[route]) throw new Error(`Missing Swagger route: ${route}`);
const server = fs.readFileSync(path.join(root, "src/app/server.js"), "utf8");
if (server.includes('AI_PIPELINE_COMPANIES || ""')) throw new Error("Runtime pipeline still uses configured company fallback");
const frontendSession = fs.readFileSync(path.join(root, "../egi-media-ai-frontend/src/shared/session-store.ts"), "utf8");
if (frontendSession.includes("startDummySession")) throw new Error("Frontend still exposes a dummy session starter");
console.log("Multi-tenant readiness gate passed: lifecycle, scope, provisioning, persistent auth, generic pipeline discovery, and frontend session boundary are present.");
