class AlertEligibilityError extends Error {
  constructor(message, { code = "BUSINESS_RULE_FAILED" } = {}) {
    super(message);
    this.name = "AlertEligibilityError";
    this.code = code;
  }
}

module.exports = { AlertEligibilityError };
