const { createSourceDatabase } = require("./source-db");
const { createAiDatabase } = require("./ai-db");

function createDatabaseRuntime(options = {}) {
  const source = createSourceDatabase(options);
  const ai = createAiDatabase(options);
  return { source, ai, async close() { await Promise.all([source.close(), ai.close()]); } };
}

module.exports = { createDatabaseRuntime, createSourceDatabase, createAiDatabase };
