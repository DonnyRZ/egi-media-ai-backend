class AiBudgetGate {
  constructor({ maxRequests = 0, maxTokens = 0, windowMs = 3600000, enforced = false, now = Date.now } = {}) { this.maxRequests = maxRequests; this.maxTokens = maxTokens; this.windowMs = windowMs; this.enforced = enforced; this.now = now; this.windowStartedAt = now(); this.requests = 0; this.tokens = 0; this.scopes = new Map(); }
  beforeRequest(scope = null) { const state = this._state(scope); this._resetIfNeeded(state); if (this.enforced && this.maxRequests > 0 && state.requests >= this.maxRequests) throw Object.assign(new Error("AI request budget exceeded"), { code: "AI_BUDGET_EXCEEDED", statusCode: 429, retryable: false }); state.requests += 1; }
  recordUsage(usage, scope = null) { const state = this._state(scope); this._resetIfNeeded(state); state.tokens += Number(usage?.totalTokens || 0); if (this.enforced && this.maxTokens > 0 && state.tokens > this.maxTokens) throw Object.assign(new Error("AI token budget exceeded"), { code: "AI_BUDGET_EXCEEDED", statusCode: 429, retryable: false }); }
  snapshot(scope = null) { const state = this._state(scope); this._resetIfNeeded(state); return { requests: state.requests, tokens: state.tokens, max_requests: this.maxRequests, max_tokens: this.maxTokens, window_started_at: new Date(state.windowStartedAt).toISOString(), scope: scope || "global" }; }
  _state(scope) { if (!scope?.tenantId) return this; const key = `${scope.tenantId}:${scope.companyId || "*"}`; if (!this.scopes.has(key)) this.scopes.set(key, { windowStartedAt: this.now(), requests: 0, tokens: 0 }); return this.scopes.get(key); }
  _resetIfNeeded(state) { if (this.now() - state.windowStartedAt >= this.windowMs) { state.windowStartedAt = this.now(); state.requests = 0; state.tokens = 0; } }
}
module.exports = { AiBudgetGate };
