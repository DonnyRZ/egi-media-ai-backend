const { createT06PromptDefinition, T06_PROMPT_ID, T06_PROMPT_VERSION } = require("./definition");
const { T06_OUTPUT_SCHEMA } = require("./schema");
const { IssueOneLinerService } = require("./service");
const { createT06IssueOneLinerRuntime } = require("./runtime");

module.exports = { createT06PromptDefinition, T06_PROMPT_ID, T06_PROMPT_VERSION, T06_OUTPUT_SCHEMA, IssueOneLinerService, createT06IssueOneLinerRuntime };
