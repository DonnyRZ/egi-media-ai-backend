import { createRequire } from "node:module";
import { Client } from "pg";

const require = createRequire(import.meta.url);
require("dotenv").config();
const { migrate } = require("../migrate-ai-db.js");

const PROJECT = "cfd6b128-a661-416d-9eb5-9d896e65c37a";
const ENV = "e964dc74-5ad4-4a01-b8c8-abc18c0de6b6";

async function railwayGql(query, variables) {
  const token = process.env.RAILWAY_PROJECT_TOKEN;
  if (!token) throw new Error("RAILWAY_PROJECT_TOKEN is required");
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { "Project-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((item) => item.message).join("; "));
  return json.data;
}

async function withPgAi(work) {
  const project = await railwayGql(
    "query ($id: String!) { project(id: $id) { services { edges { node { id name } } } } }",
    { id: PROJECT },
  );
  const services = Object.fromEntries(project.project.services.edges.map((edge) => [edge.node.name, edge.node.id]));
  const serviceId = services["pg-ai"];
  if (!serviceId) throw new Error("Railway service pg-ai was not found");
  const listed = await railwayGql(
    "query ($id: String!) { environment(id: $id) { tcpProxies { id domain proxyPort applicationPort serviceId } } }",
    { id: ENV },
  ).catch(() => ({ environment: { tcpProxies: [] } }));
  const leftover = (listed.environment?.tcpProxies || []).filter((item) => item.serviceId === serviceId && item.applicationPort === 5432);
  let proxy = leftover.find((item) => item.domain && item.proxyPort) || leftover[0] || null;
  let created = false;
  if (!proxy?.domain || !proxy?.proxyPort) {
    const out = await railwayGql(
      "mutation ($input: TCPProxyCreateInput!) { tcpProxyCreate(input: $input) { id domain proxyPort syncStatus } }",
      { input: { serviceId, environmentId: ENV, applicationPort: 5432 } },
    );
    proxy = out.tcpProxyCreate;
    created = true;
    for (let i = 0; i < 12 && (!proxy.domain || !proxy.proxyPort); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const fresh = await railwayGql(
        "query ($id: String!) { tcpProxy(id: $id) { id domain proxyPort syncStatus } }",
        { id: proxy.id },
      ).catch(() => null);
      if (fresh?.tcpProxy) proxy = fresh.tcpProxy;
    }
  }
  if (!proxy.domain || !proxy.proxyPort) throw new Error("TCP proxy for pg-ai did not become ready");
  try {
    const vars = await railwayGql(
      "query ($projectId: String!, $environmentId: String!, $serviceId: String) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }",
      { projectId: PROJECT, environmentId: ENV, serviceId },
    );
    const internal = vars.variables?.DATABASE_URL || vars.variables?.POSTGRES_URL;
    if (!internal) throw new Error("No DATABASE_URL on pg-ai");
    const parsed = new URL(internal.replace(/^postgresql:\/\//, "http://"));
    const auth = `${encodeURIComponent(parsed.username)}:${encodeURIComponent(parsed.password)}`;
    const aiUrl = `postgresql://${auth}@${proxy.domain}:${proxy.proxyPort}${parsed.pathname}?sslmode=no-verify`;
    return await work(aiUrl);
  } finally {
    if (created) {
      try {
        await railwayGql("mutation ($id: String!) { tcpProxyDelete(id: $id) }", { id: proxy.id });
      } catch (error) {
        console.error("proxy_delete_failed", error.message);
      }
    }
  }
}

const applied = await withPgAi(async (aiUrl) => {
  const client = new Client({
    connectionString: aiUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  try {
    await migrate({
      client,
      env: { SOURCE_DATABASE_URL: aiUrl, AI_DATABASE_URL: aiUrl },
    });
    const result = await client.query("SELECT version FROM ai.schema_migrations WHERE version LIKE '0018%'");
    return result.rows.map((row) => row.version);
  } finally {
    await client.end();
  }
});
console.log("migrated", applied);
