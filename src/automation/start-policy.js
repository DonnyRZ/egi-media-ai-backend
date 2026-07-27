/**
 * Decide which automation loops start when the HTTP server begins serving.
 * Scheduler (Automatic intake) and workers (job processors) are independent:
 * manual News intake must still run when the scheduler is off.
 *
 * `automation.enabled` must already reflect Automatic intake **desired** state
 * (persisted desired, or AI_SCHEDULER_ENABLED only as the initial seed when none exists).
 * Do not treat AI_SCHEDULER_CATCH_UP as live behavior — it is dead config.
 */
function resolveAutomationStart(automation = {}) {
  return {
    startScheduler: Boolean(automation.enabled),
    startWorkers: automation.workersEnabled !== false,
  };
}

module.exports = { resolveAutomationStart };
