const { createHash } = require("crypto");
const { T12_PROMPT_VERSION } = require("../ai/tasks/t12-direct-blurbs/definition");
const { renderDirectAlertTemplate } = require("./direct-alert.template");

class EmailDeliveryService {
  constructor({ eventStore, blurbStore, issueStore, analysisStore, recipientStore, deliveryStore, provider, emailConfig, authorizeCompany = denyByDefault, sleep = defaultSleep }) {
    if (!eventStore?.get || !eventStore?.markDeliveryBlocked) throw configError("Email delivery requires alert event persistence");
    if (!blurbStore?.get || !issueStore?.getIssue || !issueStore?.getDevelopment || !issueStore?.getArticleForDevelopment || !analysisStore?.getCurrent) throw configError("Email delivery requires validated direct-alert content reads");
    if (!recipientStore?.get || !deliveryStore?.getByAlertEventId || !deliveryStore?.create || !deliveryStore?.recordAttempt || !deliveryStore?.markSent || !deliveryStore?.markFailed) throw configError("Email delivery requires recipient and delivery audit persistence");
    if (!provider?.send || !emailConfig?.retry) throw configError("Email delivery requires a provider and retry configuration");
    Object.assign(this, { eventStore, blurbStore, issueStore, analysisStore, recipientStore, deliveryStore, provider, emailConfig, authorizeCompany, sleep });
  }

  async deliver({ tenantId, companyId, alertEventId }) {
    await this._authorizeCompany({ tenantId, companyId });
    const event = this.eventStore.get({ tenantId, companyId, alertEventId });
    if (!event || event.channel !== "langsung" || event.status !== "eligible") throw configError("Email delivery requires an eligible direct alert event in the same tenant and company");
    let prepared;
    try { prepared = this._prepare({ tenantId, companyId, event }); }
    catch (error) { this.eventStore.markDeliveryBlocked({ tenantId, companyId, alertEventId, reasonCode: "delivery_required_field_missing" }); throw error; }

    let delivery = this.deliveryStore.getByAlertEventId({ tenantId, companyId, alertEventId });
    if (delivery?.status === "sent") return { delivery, reused: true };
    if (!delivery) delivery = this.deliveryStore.create({
      tenantId, companyId, alertEventId, recipientId: prepared.recipient.recipientId, recipientEmail: prepared.recipient.email,
      templateVersion: prepared.template.templateVersion, subject: prepared.template.subject, idempotencyKey: deliveryKey({ tenantId, companyId, alertEventId }),
    });

    const maxAttempts = validatedMaxAttempts(this.emailConfig.retry.maxAttempts);
    for (let attempt = delivery.attempts.length + 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await this.provider.send({
          to: prepared.recipient.email, subject: prepared.template.subject, text: prepared.template.text, html: prepared.template.html, idempotencyKey: delivery.idempotencyKey,
        });
        this.deliveryStore.recordAttempt({ tenantId, companyId, deliveryId: delivery.deliveryId, attempt, outcome: "sent", providerMessageId: result?.providerMessageId || null });
        delivery = this.deliveryStore.markSent({ tenantId, companyId, deliveryId: delivery.deliveryId, providerMessageId: result?.providerMessageId || null });
        return { delivery, reused: false };
      } catch (error) {
        const retryable = isRetryableProviderError(error);
        this.deliveryStore.recordAttempt({ tenantId, companyId, deliveryId: delivery.deliveryId, attempt, outcome: retryable && attempt < maxAttempts ? "retrying" : "failed", errorCode: providerErrorCode(error) });
        if (!retryable || attempt === maxAttempts) {
          delivery = this.deliveryStore.markFailed({ tenantId, companyId, deliveryId: delivery.deliveryId, errorCode: providerErrorCode(error) });
          return { delivery, reused: false };
        }
        await this.sleep(backoffMs({ baseDelayMs: this.emailConfig.retry.baseDelayMs, attempt }));
      }
    }
    throw configError("Email delivery retry loop exhausted unexpectedly");
  }

  _prepare({ tenantId, companyId, event }) {
    const issue = this.issueStore.getIssue({ tenantId, companyId, issueId: event.issueId });
    const development = this.issueStore.getDevelopment({ tenantId, companyId, developmentId: event.developmentId });
    const article = this.issueStore.getArticleForDevelopment({ tenantId, companyId, developmentId: event.developmentId });
    const analysis = issue && this.analysisStore.getCurrent({ tenantId, companyId, issueId: issue.issueId });
    const blurb = this.blurbStore.get({ alertEventId: event.alertEventId, promptVersion: T12_PROMPT_VERSION });
    const recipient = this.recipientStore.get({ tenantId, companyId, recipientId: event.recipientId });
    if (!issue || typeof issue.title !== "string" || !issue.title.trim() || typeof issue.oneLiner !== "string" || !issue.oneLiner.trim()
      || issue.currentPriority !== "tinggi" || !development || development.issueId !== issue.issueId || !article?.canonicalUrl || !analysis?.gate
      || !blurb || !Array.isArray(blurb.sourceClaimIds) || blurb.sourceClaimIds.length < 1 || !recipient?.email) {
      throw configError("Email delivery requires current validated direct-alert fields");
    }
    const template = renderDirectAlertTemplate({ issue, blurb, detailUrl: article.canonicalUrl });
    if (!template.subject || !template.text || !template.html || !this.emailConfig.from?.address) throw configError("Email delivery template or sender is incomplete");
    return { issue, recipient, template };
  }

  async _authorizeCompany({ tenantId, companyId }) {
    const granted = await this.authorizeCompany({ tenantId, companyId, action: "email.delivery.send" });
    if (granted !== true) throw configError("Email delivery tenant/company authorization was not granted", "FORBIDDEN");
  }
}

function deliveryKey({ tenantId, companyId, alertEventId }) { return createHash("sha256").update(`${tenantId}|${companyId}|${alertEventId}|direct-alert-v1`).digest("hex"); }
function validatedMaxAttempts(value) { if (!Number.isInteger(value) || value < 1 || value > 5) throw configError("Email retry max attempts must be an integer from 1 to 5"); return value; }
function backoffMs({ baseDelayMs, attempt }) { const base = Number.isInteger(baseDelayMs) && baseDelayMs >= 0 ? baseDelayMs : 1000; return base * (2 ** (attempt - 1)); }
function isRetryableProviderError(error) { return !error?.accepted && ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ESOCKET", "EAI_AGAIN", "EHOSTUNREACH"].includes(error?.code); }
function providerErrorCode(error) { return typeof error?.code === "string" ? error.code : "PROVIDER_ERROR"; }
function configError(message, code = "BUSINESS_RULE_FAILED") { const error = new Error(message); error.code = code; return error; }
function denyByDefault() { throw configError("Email delivery requires a tenant/company authorization guard", "FORBIDDEN"); }
function defaultSleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

module.exports = { EmailDeliveryService, deliveryKey, isRetryableProviderError, backoffMs };
