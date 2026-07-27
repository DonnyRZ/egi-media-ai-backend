const { randomUUID } = require("crypto");
class IngestScheduler {
  constructor({ config, enqueuePoll, stateStore, logger = null, sourceName = "egi-media-cms", tenantId, companyId, now = Date.now, setTimer = setInterval, clearTimer = clearInterval } = {}) { if (!config || typeof enqueuePoll !== "function" || !stateStore) throw new TypeError("Scheduler requires config, enqueue service, and state store"); Object.assign(this, { config, enqueuePoll, stateStore, logger: logger || { info() {}, warn() {}, error() {} }, sourceName, tenantId, companyId, now, setTimer, clearTimer, timer: null, owner: `scheduler-${randomUUID()}`, running: false }); }
  start() {
    if (!this.config.enabled || this.timer) return false;
    this.running = true;
    this._safeTick();
    this.timer = this.setTimer(() => this._safeTick(), this.config.intervalMs);
    return true;
  }
  _safeTick() {
    Promise.resolve(this.tick()).catch((error) => {
      this.logger.error?.("scheduler_tick_failed", { error });
    });
  }
  async tick() { if (!this.running) return null; const results = []; for (const locale of this.config.locales) { const scope = { sourceName: this.sourceName, locale }; if (!this.stateStore.acquire(scope, this.owner, this.config.intervalMs)) continue; try { const result = await this.enqueuePoll({ tenantId: this.tenantId, companyId: this.companyId, locale, limit: this.config.batchSize, scheduleKey: "default", trigger: "scheduled" }); this.stateStore.record(scope, { lastEnqueueAt: new Date(this.now()).toISOString(), lastEnqueueStatus: "queued", lastJobId: result.job?.jobId || null }); results.push(result); } catch (error) { this.stateStore.record(scope, { lastEnqueueStatus: "failed", lastErrorCode: error.code || "SCHEDULER_ENQUEUE_FAILED" }); this.logger.error?.("scheduler_enqueue_failed", { locale, error }); } finally { this.stateStore.release(scope, this.owner); } } return results; }
  stop() { if (this.timer) this.clearTimer(this.timer); this.timer = null; this.running = false; }
  status() { return { enabled: this.config.enabled, running: this.running, interval_ms: this.config.intervalMs, locales: this.config.locales, state: this.config.locales.map((locale) => this.stateStore.get({ sourceName: this.sourceName, locale })).filter(Boolean) }; }
}
class MultiTenantIngestScheduler extends IngestScheduler {
  constructor({ listEligible, ...options } = {}) {
    super(options);
    if (typeof listEligible !== "function") throw new TypeError("Multi-tenant scheduler requires an eligible company provider");
    this.listEligible = listEligible;
  }
  async tick() {
    if (!this.running) return null;
    const results = [];
    let companies = [];
    try {
      companies = await this.listEligible();
    } catch (error) {
      this.logger.error?.("scheduler_list_eligible_failed", { error });
      return results;
    }
    for (const company of companies) for (const locale of this.config.locales) {
      const scope = { sourceName: this.sourceName, tenantId: company.tenantId, companyId: company.companyId, locale };
      if (!this.stateStore.acquire(scope, this.owner, this.config.intervalMs)) continue;
      try {
        const result = await this.enqueuePoll({ ...company, locale, limit: this.config.batchSize, scheduleKey: `${company.tenantId}-${company.companyId}`, trigger: "scheduled" });
        this.stateStore.record(scope, { lastEnqueueAt: new Date(this.now()).toISOString(), lastEnqueueStatus: "queued", lastJobId: result.job?.jobId || null }); results.push(result);
      } catch (error) {
        this.stateStore.record(scope, { lastEnqueueStatus: "failed", lastErrorCode: error.code || "SCHEDULER_ENQUEUE_FAILED" });
        this.logger.error?.("scheduler_enqueue_failed", { tenantId: company.tenantId, companyId: company.companyId, locale, error });
      } finally { this.stateStore.release(scope, this.owner); }
    }
    return results;
  }
  status() {
    const base = super.status();
    const listed = typeof this.stateStore.list === "function"
      ? this.stateStore.list().filter((state) => state.sourceName === this.sourceName)
      : base.state;
    return { ...base, state: listed };
  }
}
module.exports = { IngestScheduler, MultiTenantIngestScheduler };
