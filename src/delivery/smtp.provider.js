const nodemailer = require("nodemailer");

function createSmtpProvider({ emailConfig, transportFactory = nodemailer.createTransport }) {
  validateConfig(emailConfig);
  const transport = transportFactory({ host: emailConfig.smtp.host, port: emailConfig.smtp.port, secure: emailConfig.smtp.secure, auth: { user: emailConfig.smtp.user, pass: emailConfig.smtp.appPassword } });
  return {
    async send({ to, subject, text, html, idempotencyKey }) {
      const result = await transport.sendMail({ from: { name: emailConfig.from.name, address: emailConfig.from.address }, to, subject, text, html, headers: { "X-EGI-Delivery-Key": idempotencyKey } });
      return { providerMessageId: result.messageId || null };
    },
  };
}
function validateConfig(config) {
  if (!config || config.transport !== "smtp" || !config.smtp?.host || !Number.isInteger(config.smtp.port) || !config.smtp.user || !config.smtp.appPassword || !config.from?.address) throw new Error("Email SMTP configuration is incomplete");
}
module.exports = { createSmtpProvider, validateConfig };
