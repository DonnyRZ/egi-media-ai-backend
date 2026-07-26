const { resolveAiOutputLanguage } = require("./ai-output-language");

/**
 * Resolve AI prose output_language from the company's stored locale preference.
 * Missing store or unsupported/null locale falls back to the default (id).
 * Does not use article content_locale.
 */
async function loadCompanyOutputLanguage({ companyStore, tenantId, companyId }) {
  if (!companyStore?.get) return resolveAiOutputLanguage(null);
  const company = await companyStore.get({ tenantId, companyId });
  return resolveAiOutputLanguage(company?.locale);
}

module.exports = { loadCompanyOutputLanguage };
