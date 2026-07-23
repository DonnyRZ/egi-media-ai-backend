const config = require("../config/global_config");
const { CmsArticleClient } = require("./cms-article.client");
const { CmsSourceGate } = require("./cms-source-gate");

function createCmsSourceGate() {
  const cmsConfig = config.get("/cms");
  const portalConfig = config.get("/portal");
  const cmsArticleClient = new CmsArticleClient(cmsConfig);
  return new CmsSourceGate({ cmsArticleClient, portalBaseUrl: portalConfig.baseUrl });
}

module.exports = { createCmsSourceGate, CmsArticleClient, CmsSourceGate };
