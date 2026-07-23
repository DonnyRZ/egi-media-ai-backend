const { InMemoryCompanyContextDraftStore } = require("../ai/tasks/t01-company-context-draft/draft.store");
const { InMemoryEffectiveCompanyContextStore } = require("./effective-context.store");
const { CompanyContextService } = require("./company-context.service");

function createCompanyContextRuntime({ draftStore, effectiveContextStore, authorize } = {}) {
  const contextDraftStore = draftStore || new InMemoryCompanyContextDraftStore();
  const effectiveStore = effectiveContextStore || new InMemoryEffectiveCompanyContextStore();

  return {
    draftStore: contextDraftStore,
    effectiveContextStore: effectiveStore,
    service: new CompanyContextService({
      draftStore: contextDraftStore,
      effectiveContextStore: effectiveStore,
      authorize,
    }),
  };
}

module.exports = { createCompanyContextRuntime };
