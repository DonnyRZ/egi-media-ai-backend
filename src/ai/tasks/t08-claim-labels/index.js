const { createT08PromptDefinition, T08_PROMPT_ID, T08_PROMPT_VERSION } = require("./definition");
const { T08_OUTPUT_SCHEMA } = require("./schema");
const { ClaimLabelService } = require("./service");
const { InMemoryClaimLabelStore } = require("./label.store");
const { createT08ClaimLabelsRuntime } = require("./runtime");
module.exports = { createT08PromptDefinition, T08_PROMPT_ID, T08_PROMPT_VERSION, T08_OUTPUT_SCHEMA, ClaimLabelService, InMemoryClaimLabelStore, createT08ClaimLabelsRuntime };
