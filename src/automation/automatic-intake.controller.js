"use strict";

/**
 * Automatic intake = process-wide CMS poll scheduler only.
 * Toggles start/stop the scheduler; workers stay independent (Pull articles now).
 */
class AutomaticIntakeController {
  constructor({
    settingsStore,
    getScheduler,
    getAutomationConfig,
    envDefaultEnabled = false,
    logger = null,
  } = {}) {
    if (!settingsStore || typeof settingsStore.get !== "function" || typeof settingsStore.setDesired !== "function") {
      throw new TypeError("AutomaticIntakeController requires settingsStore");
    }
    if (typeof getScheduler !== "function") throw new TypeError("AutomaticIntakeController requires getScheduler");
    if (typeof getAutomationConfig !== "function") throw new TypeError("AutomaticIntakeController requires getAutomationConfig");
    this.settingsStore = settingsStore;
    this.getScheduler = getScheduler;
    this.getAutomationConfig = getAutomationConfig;
    this.envDefaultEnabled = Boolean(envDefaultEnabled);
    this.logger = logger || { info() {}, warn() {}, error() {} };
  }

  /**
   * Boot rule: persisted desired wins; else seed from AI_SCHEDULER_ENABLED (env default only).
   */
  async resolveDesiredOnBoot() {
    const existing = await this.settingsStore.get();
    if (existing && typeof existing.desired === "boolean") {
      this.logger.info?.("automatic_intake_desired_loaded", {
        desired: existing.desired,
        source: existing.source,
        updated_at: existing.updatedAt,
      });
      return existing.desired;
    }
    const seeded = await this.settingsStore.setDesired(this.envDefaultEnabled, { source: "env_default" });
    this.logger.info?.("automatic_intake_desired_seeded_from_env", {
      desired: seeded.desired,
      source: seeded.source,
    });
    return seeded.desired;
  }

  applyToScheduler(desired) {
    const scheduler = this.getScheduler();
    if (!scheduler) return { applied: false, reason: "scheduler_unavailable" };
    const want = Boolean(desired);
    if (scheduler.config && typeof scheduler.config === "object") {
      scheduler.config.enabled = want;
    }
    if (want) {
      const started = scheduler.start();
      return { applied: true, desired: want, started: Boolean(started), running: Boolean(scheduler.running) };
    }
    scheduler.stop();
    return { applied: true, desired: want, started: false, running: Boolean(scheduler.running) };
  }

  async setDesired(desired, { actorId = null, role = null } = {}) {
    const want = Boolean(desired);
    const record = await this.settingsStore.setDesired(want, { source: "manage_api" });
    const apply = this.applyToScheduler(record.desired);
    this.logger.info?.("automatic_intake_desired_changed", {
      desired: record.desired,
      actual_running: apply.running,
      actorId,
      role,
    });
    return this.getStatus();
  }

  async getStatus() {
    const record = await this.settingsStore.get();
    const config = this.getAutomationConfig() || {};
    const scheduler = this.getScheduler();
    const schedulerStatus = typeof scheduler?.status === "function" ? scheduler.status() : {};
    const last = summarizeSchedulerState(schedulerStatus.state || []);
    return {
      desired: Boolean(record?.desired),
      actual_running: Boolean(schedulerStatus.running),
      interval_ms: Number(config.intervalMs || schedulerStatus.interval_ms || 0) || null,
      batch_size: Number(config.batchSize || 0) || null,
      locales: Array.isArray(config.locales) ? [...config.locales] : (schedulerStatus.locales || []),
      last_enqueue_at: last.lastEnqueueAt,
      last_enqueue_status: last.lastEnqueueStatus,
      last_error_code: last.lastErrorCode,
      last_job_id: last.lastJobId,
      desired_source: record?.source || null,
      desired_updated_at: record?.updatedAt || null,
      // Scheduler.enabled mirrors desired after apply; exposed for ops parity with raw scheduler.status
      scheduler_enabled: Boolean(schedulerStatus.enabled),
    };
  }
}

function summarizeSchedulerState(states = []) {
  let best = null;
  for (const state of states) {
    if (!state) continue;
    const at = state.lastEnqueueAt ? Date.parse(state.lastEnqueueAt) : NaN;
    if (!best) {
      best = state;
      continue;
    }
    const bestAt = best.lastEnqueueAt ? Date.parse(best.lastEnqueueAt) : NaN;
    if (Number.isFinite(at) && (!Number.isFinite(bestAt) || at >= bestAt)) best = state;
    else if (!Number.isFinite(bestAt) && state.lastErrorCode && !best.lastErrorCode) best = state;
  }
  return {
    lastEnqueueAt: best?.lastEnqueueAt || null,
    lastEnqueueStatus: best?.lastEnqueueStatus || null,
    lastErrorCode: best?.lastErrorCode || null,
    lastJobId: best?.lastJobId || null,
  };
}

module.exports = { AutomaticIntakeController, summarizeSchedulerState };
