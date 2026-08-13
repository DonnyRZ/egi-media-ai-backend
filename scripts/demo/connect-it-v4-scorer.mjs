import dotenv from "dotenv";

dotenv.config();

const TOKEN = process.env.RAILWAY_PROJECT_TOKEN;
const PROJECT = "cfd6b128-a661-416d-9eb5-9d896e65c37a";
const ENV = "e964dc74-5ad4-4a01-b8c8-abc18c0de6b6";
const SCORER = "9aadbcab-5bc5-4f16-b212-0454698fa71e";
const AI_API = "bd584b23-533c-4879-896a-77e2af97c32f";

async function gql(query, variables) {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { "Project-Access-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((item) => item.message).join("; "));
  return json.data;
}

const connected = await gql(
  `mutation ($id: String, $input: ServiceConnectInput!) {
    serviceConnect(id: $id, input: $input)
  }`,
  { id: SCORER, input: { repo: "DonnyRZ/egi-media-ai-backend", branch: "main" } },
);
console.log("connected", connected);

const updated = await gql(
  `mutation ($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
    serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
  }`,
  {
    environmentId: ENV,
    serviceId: SCORER,
    input: {
      rootDirectory: "services/it-v4-scorer",
      dockerfilePath: "Dockerfile",
      healthcheckPath: "/health",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
      railwayConfigFile: "railway.toml",
    },
  },
);
console.log("updated", updated);

const scorerDeploy = await gql(
  `mutation ($serviceId: String!, $environmentId: String!) {
    serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
  }`,
  { serviceId: SCORER, environmentId: ENV },
);
console.log("scorer_deploy", scorerDeploy);

const apiDeploy = await gql(
  `mutation ($serviceId: String!, $environmentId: String!) {
    serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
  }`,
  { serviceId: AI_API, environmentId: ENV },
);
console.log("ai_api_deploy", apiDeploy);
console.log("project", PROJECT);
