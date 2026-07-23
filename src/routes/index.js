const { createCompanyContextRouter } = require("./company-context");

module.exports = (server, { companyContextService }) => {
  server.use(createCompanyContextRouter({ companyContextService }));
};
