"use strict";

const { setTimeout: sleep } = require("timers/promises");

class OpenAiRateLimiter {
  constructor({
    maxConcurrency = 2,
    requestsPerMinute = 0,
    tokensPerMinute = 0,
    safetyRatio = 0.8,
    now = Date.now,
    sleepFn = sleep,
  } = {}) {
    this.maxConcurrency = positiveInteger(maxConcurrency, 2);
    this.requestsPerMinute = positiveOrZero(requestsPerMinute, 0);
    this.tokensPerMinute = positiveOrZero(tokensPerMinute, 0);
    this.safetyRatio = bounded(safetyRatio, 0.1, 1, 0.8);
    this.now = now;
    this.sleep = sleepFn;
    this.active = 0;
    this.windows = new Map();
    this.cooldowns = new Map();
  }

  async acquire({ model = "default", estimatedTokens = 0 } = {}) {
    const key = String(model || "default");
    const reservation = Math.max(0, Math.ceil(Number(estimatedTokens) || 0));

    while (true) {
      const waitMs = this._waitFor(key, reservation);
      if (waitMs <= 0) {
        const entry = this._window(key);
        const at = this.now();
        entry.requests.push(at);
        const tokenReservation = { at, value: reservation };
        entry.tokens.push(tokenReservation);
        this.active += 1;
        let released = false;
        return {
          release: ({ actualTokens } = {}) => {
            if (released) return;
            released = true;
            this.active = Math.max(0, this.active - 1);
            const actual = Number(actualTokens);
            if (Number.isFinite(actual) && actual >= 0) tokenReservation.value = Math.max(tokenReservation.value, Math.ceil(actual));
          },
        };
      }
      await this.sleep(waitMs);
    }
  }

  observeRateLimit({ model = "default", retryAfterMs = 0, resetRequestsMs = 0, resetTokensMs = 0 } = {}) {
    const key = String(model || "default");
    const waits = [retryAfterMs, resetRequestsMs, resetTokensMs]
      .map((value) => Number(value) || 0)
      .filter((value) => value > 0);
    if (waits.length > 0) this.cooldowns.set(key, this.now() + Math.max(...waits));
  }

  snapshot(model = "default") {
    const key = String(model || "default");
    const entry = this._window(key);
    this._prune(entry);
    return {
      model: key,
      active: this.active,
      maxConcurrency: this.maxConcurrency,
      requestsInWindow: entry.requests.length,
      reservedTokensInWindow: entry.tokens.reduce((sum, item) => sum + item.value, 0),
      cooldownUntil: this.cooldowns.get(key) || null,
    };
  }

  _waitFor(key, estimatedTokens) {
    const entry = this._window(key);
    this._prune(entry);
    const now = this.now();
    const waits = [];
    if (this.active >= this.maxConcurrency) waits.push(50);
    const cooldownUntil = this.cooldowns.get(key) || 0;
    if (cooldownUntil > now) waits.push(cooldownUntil - now);

    const requestLimit = this.requestsPerMinute * this.safetyRatio;
    if (requestLimit > 0 && entry.requests.length >= requestLimit) {
      waits.push(Math.max(1, entry.requests[0] + 60_000 - now));
    }

    const tokenLimit = this.tokensPerMinute * this.safetyRatio;
    const reserved = entry.tokens.reduce((sum, item) => sum + item.value, 0);
    if (tokenLimit > 0 && reserved + estimatedTokens > tokenLimit && entry.tokens.length > 0) {
      waits.push(Math.max(1, entry.tokens[0].at + 60_000 - now));
    }

    return waits.length > 0 ? Math.max(...waits) : 0;
  }

  _window(key) {
    if (!this.windows.has(key)) this.windows.set(key, { requests: [], tokens: [] });
    return this.windows.get(key);
  }

  _prune(entry) {
    const cutoff = this.now() - 60_000;
    entry.requests = entry.requests.filter((at) => at > cutoff);
    entry.tokens = entry.tokens.filter((item) => item.at > cutoff);
  }
}

function positiveOrZero(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function bounded(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

module.exports = { OpenAiRateLimiter };
