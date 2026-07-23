const { InMemoryRecipientStore } = require("./recipient.store");
const { InMemoryEmailDeliveryStore } = require("./email-delivery.store");
const { renderDirectAlertTemplate, TEMPLATE_VERSION } = require("./direct-alert.template");
const { createSmtpProvider } = require("./smtp.provider");
const { EmailDeliveryService } = require("./email-delivery.service");
const { createEmailDeliveryRuntime } = require("./runtime");
module.exports = { InMemoryRecipientStore, InMemoryEmailDeliveryStore, renderDirectAlertTemplate, TEMPLATE_VERSION, createSmtpProvider, EmailDeliveryService, createEmailDeliveryRuntime };
