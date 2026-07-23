const { AiConfigurationError } = require("./provider.errors");

const MODEL_ALIASES = Object.freeze({
  nano: "nanoModel",
  mini: "miniModel",
});

function resolveModel(modelAlias, openaiConfig) {
  const configKey = MODEL_ALIASES[modelAlias];

  if (!configKey) {
    throw new AiConfigurationError("Unsupported AI model alias", {
      details: { modelAlias },
    });
  }

  const model = openaiConfig[configKey];
  if (!model || typeof model !== "string") {
    throw new AiConfigurationError("Configured AI model is missing", {
      details: { modelAlias, configKey },
    });
  }

  return model;
}

module.exports = { MODEL_ALIASES, resolveModel };
