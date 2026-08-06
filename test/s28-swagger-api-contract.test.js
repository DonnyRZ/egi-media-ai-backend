const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Ajv = require("ajv");

const root = path.join(__dirname, "..");
const document = JSON.parse(fs.readFileSync(path.join(root, "swagger_output.json"), "utf8"));
const methods = new Set(["get", "post", "put", "patch", "delete"]);

function actualRoutes() {
  const routes = [];
  for (const file of fs.readdirSync(path.join(root, "src", "routes"))) {
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(root, "src", "routes", file), "utf8");
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\("([^"]+)"/g)) {
      routes.push({ method: match[1], path: match[2].replace(/:([A-Za-z0-9_]+)/g, "{$1}") });
    }
  }
  return routes;
}

function resolve(ref) {
  assert.match(ref, /^#\/components\/(schemas|parameters|responses)\//);
  const [, , group, name] = ref.split("/");
  assert.ok(document.components?.[group]?.[name], `Swagger reference must resolve: ${ref}`);
  return document.components[group][name];
}

function dereference(value, stack = new Set()) {
  if (Array.isArray(value)) return value.map((item) => dereference(item, stack));
  if (!value || typeof value !== "object") return value;
  if (value.$ref) {
    if (stack.has(value.$ref)) return {};
    const nextStack = new Set(stack).add(value.$ref);
    return dereference(resolve(value.$ref), nextStack);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, dereference(child, stack)]));
}

function sample(schema) {
  schema = dereference(schema);
  if (!schema) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.oneOf?.length) return sample(schema.oneOf.find((variant) => variant.type === "null") || schema.oneOf[0]);
  if (schema.anyOf?.length) return sample(schema.anyOf[0]);
  if (schema.allOf?.length) return Object.assign({}, ...schema.allOf.map(sample));
  if (schema.type === "object" || schema.properties) {
    const value = {};
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if ((schema.required || []).includes(key)) value[key] = sample(child);
    }
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) value[key] = "example";
    return value;
  }
  if (schema.type === "array") return Array.from({ length: Math.max(1, schema.minItems || 1) }, () => sample(schema.items));
  if (Array.isArray(schema.type)) return schema.type.includes("string") ? "example" : null;
  if (schema.type === "integer" || schema.type === "number") return schema.minimum ?? 1;
  if (schema.type === "boolean") return true;
  if (schema.type === "null") return null;
  return "example";
}

function validateExample(schema, value, label) {
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validator = ajv.compile(dereference(schema));
  assert.equal(validator(value), true, `${label}: ${JSON.stringify(validator.errors)}`);
}

function executableExample(operation, routePath) {
  const request = { path: routePath, query: {}, headers: {}, body: undefined };
  for (const parameterRef of operation.parameters || []) {
    const parameter = dereference(parameterRef);
    const value = sample(parameter.schema);
    if (parameter.in === "path") request.path = request.path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
    if (parameter.in === "query") request.query[parameter.name] = value;
    if (parameter.in === "header") request.headers[parameter.name] = value;
  }
  const jsonBody = operation.requestBody && dereference(operation.requestBody).content?.["application/json"];
  if (jsonBody?.schema) {
    request.body = sample(jsonBody.schema);
    validateExample(jsonBody.schema, request.body, `${operation.operationId} request`);
  }
  for (const [status, responseRef] of Object.entries(operation.responses || {})) {
    const response = dereference(responseRef);
    const json = response.content?.["application/json"];
    if (json?.schema) validateExample(json.schema, sample(json.schema), `${operation.operationId} response ${status}`);
  }
  return request;
}

test("S28 every implemented route is represented by an OpenAPI operation", () => {
  const documented = new Set();
  for (const [routePath, item] of Object.entries(document.paths || {})) {
    for (const method of methods) if (item[method]) documented.add(`${method} ${routePath}`);
  }
  for (const route of actualRoutes()) assert.ok(documented.has(`${route.method} ${route.path}`), `Missing Swagger operation: ${route.method.toUpperCase()} ${route.path}`);
});

test("S28 every operation has valid references, responses, and request/response schemas", () => {
  assert.equal(document.openapi, "3.0.3");
  assert.ok(document.components?.schemas && document.components?.parameters && document.components?.responses);
  for (const [routePath, item] of Object.entries(document.paths || {})) {
    for (const method of methods) {
      const operation = item[method];
      if (!operation) continue;
      assert.ok(operation.responses && Object.keys(operation.responses).length > 0, `${operation.operationId} responses`);
      executableExample(operation, routePath);
    }
  }
});

test("S28 generated Swagger examples are executable as contract requests", () => {
  const examples = [];
  for (const [routePath, item] of Object.entries(document.paths || {})) {
    for (const method of methods) if (item[method]) examples.push(executableExample(item[method], routePath));
  }
  assert.equal(examples.length, 88);
  assert.ok(examples.every((example) => typeof example.path === "string" && example.path.startsWith("/api/v1/")));
});
