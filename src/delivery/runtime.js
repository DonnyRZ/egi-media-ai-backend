const config = require("../config/global_config");
const { createSmtpProvider } = require("./smtp.provider");
const { EmailDeliveryService } = require("./email-delivery.service");

function createEmailDeliveryRuntime({ eventStore, blurbStore, issueStore, analysisStore, recipientStore, deliveryStore, authorizeCompany, provider, emailConfig } = {}) {
  const resolvedEmailConfig = emailConfig || config.get("/email");
  const resolvedProvider = provider || createSmtpProvider({ emailConfig: resolvedEmailConfig });
  return {
    service: new EmailDeliveryService({ eventStore, blurbStore, issueStore, analysisStore, recipientStore, deliveryStore, provider: resolvedProvider, emailConfig: resolvedEmailConfig, authorizeCompany }),
    provider: resolvedProvider,
  };
}

module.exports = { createEmailDeliveryRuntime };
