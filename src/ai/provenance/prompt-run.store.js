const { deepFreeze } = require("../prompt/registry/prompt-definition");

class InMemoryPromptRunStore {
  constructor() {
    this.runs = [];
  }

  record(run) {
    const storedRun = deepFreeze(structuredClone(run));
    this.runs.push(storedRun);
    return deepFreeze(structuredClone(storedRun));
  }

  list() {
    return this.runs.map((run) => deepFreeze(structuredClone(run)));
  }
}

module.exports = { InMemoryPromptRunStore };
