class QueueWorkerRunner {
  constructor({ processNext, recoverStale = null, queueNames = [], intervalMs = 1000, concurrency = 1, logger = null, setTimer = setInterval, clearTimer = clearInterval } = {}) { if (typeof processNext !== "function") throw new TypeError("Worker runner requires processNext"); Object.assign(this, { processNext, recoverStale, queueNames, intervalMs, concurrency, logger: logger || { info() {}, warn() {}, error() {} }, setTimer, clearTimer, timer: null, running: false }); }
  start() { if (this.timer) return false; this.running = true; this.timer = this.setTimer(() => this._safePump(), this.intervalMs); this._safePump(); return true; }
  _safePump() { Promise.resolve(this.pump()).catch((error) => this.logger.error?.("worker_pump_failed", { error: error.message })); }
  async pump() { if (!this.running) return []; await Promise.resolve(this.recoverStale?.()).catch((error) => this.logger.error?.("worker_stale_recovery_failed", { error: error.message })); const work = []; for (let i = 0; i < this.concurrency; i += 1) for (const queueName of this.queueNames) work.push(Promise.resolve(this.processNext(queueName)).catch((error) => { this.logger.error?.("worker_job_failed", { queueName, error: error.message }); return null; })); return Promise.all(work); }
  stop() { if (this.timer) this.clearTimer(this.timer); this.timer = null; this.running = false; }
  status() { return { running: this.running, queue_names: this.queueNames, concurrency: this.concurrency, interval_ms: this.intervalMs }; }
}
module.exports = { QueueWorkerRunner };
