const { Client } = require("pg");
const crypto = require("node:crypto");
require("dotenv").config();

async function seed() {
  if (process.env.APP_ENV === "production" || process.env.SEED_GENERIC_TENANT !== "true") throw new Error("Refusing to seed. Set SEED_GENERIC_TENANT=true in a non-production environment.");
  if (!process.env.AI_DATABASE_URL) throw new Error("AI_DATABASE_URL is required");
  const tenantId = process.env.SEED_TENANT_ID || "tenant-generic-demo";
  const companyId = process.env.SEED_COMPANY_ID || "company-generic-demo";
  const email = String(process.env.SEED_OWNER_EMAIL || "owner@example.com").toLowerCase();
  const userId = `user:${email}`;
  const client = new Client({ connectionString: process.env.AI_DATABASE_URL }); await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO ai.tenants (id,name,legal_name,status,timezone,default_locale,metadata_jsonb) VALUES ($1,$2,$3,'active','UTC','id',$4::jsonb) ON CONFLICT (id) DO UPDATE SET status='active',updated_at=now()", [tenantId, "Generic Customer Tenant", "Generic Customer Tenant", JSON.stringify({ seed: "generic-demo" })]);
    await client.query("INSERT INTO ai.companies (id,tenant_id,name,status,timezone,locale,metadata_jsonb) VALUES ($1,$2,$3,'active','UTC','id',$4::jsonb) ON CONFLICT (tenant_id,id) DO UPDATE SET status='active',updated_at=now()", [companyId, tenantId, "Generic Customer Company", JSON.stringify({ seed: "generic-demo" })]);
    await client.query("INSERT INTO ai.users (id,email,full_name,status) VALUES ($1,$2,$3,'active') ON CONFLICT (email) DO UPDATE SET status='active',updated_at=now()", [userId, email, process.env.SEED_OWNER_NAME || "Generic Tenant Owner"]);
    await client.query("INSERT INTO ai.memberships (id,user_id,tenant_id,company_id,role,status) VALUES ($1,$2,$3,$4,'tenant_owner','active') ON CONFLICT (user_id,tenant_id,company_id) DO UPDATE SET role='tenant_owner',status='active',version=ai.memberships.version+1,updated_at=now()", [`membership:${tenantId}:${userId}:${companyId}`, userId, tenantId, companyId]);
    await client.query("COMMIT"); console.log(JSON.stringify({ tenantId, companyId, ownerEmail: email }));
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { await client.end(); }
}

if (require.main === module) seed().catch((error) => { console.error(`Generic tenant seed failed: ${error.message}`); process.exitCode = 1; });
module.exports = { seed };
