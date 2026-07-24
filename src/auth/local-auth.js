const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

class LocalAuthService {
  constructor({ email, password, secret, accountStore = null } = {}) {
    this.email = String(email || "").trim().toLowerCase();
    this.password = String(password || "");
    this.secret = secret;
    this.accountStore = accountStore;
    if (!this.email || !this.password || !this.secret) throw new TypeError("Local auth bootstrap requires email, password, and secret");
    this.passwordHash = hashPassword(this.password);
    this.accounts = new Map([[this.email, { email: this.email, fullName: "Platform Administrator", role: "platform_superadmin", actorType: "human", passwordHash: this.passwordHash }]]);
  }

  async login({ email, password }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const account = this.accounts.get(normalizedEmail) || await this.accountStore?.find?.(normalizedEmail);
    if (!account || !verifyPassword(String(password || ""), account.passwordHash)) {
      throw Object.assign(new Error("Email or password is invalid"), { code: "UNAUTHORIZED", statusCode: 401 });
    }
    const userId = `user:${normalizedEmail}`;
    const actor = { id: userId, email: normalizedEmail, full_name: account.fullName, role: account.role, actor_type: account.actorType };
    return { accessToken: jwt.sign(actor, this.secret, { expiresIn: "8h" }), actor };
  }

  async signup({ email, password, fullName }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail.includes("@") || String(password || "").length < 8 || !String(fullName || "").trim()) throw Object.assign(new Error("Signup requires full name, valid email, and password of at least 8 characters"), { code: "VALIDATION_ERROR", statusCode: 400 });
    if (this.accounts.has(normalizedEmail) || await this.accountStore?.find?.(normalizedEmail)) throw Object.assign(new Error("An account with this email already exists"), { code: "CONFLICT", statusCode: 409 });
    const passwordHash = hashPassword(password); const account = { email: normalizedEmail, fullName: String(fullName).trim(), role: null, actorType: "human", passwordHash };
    await this.accountStore?.save?.({ userId: `user:${normalizedEmail}`, ...account }); this.accounts.set(normalizedEmail, account);
    return { userId: `user:${normalizedEmail}`, email: normalizedEmail, fullName: String(fullName).trim(), status: "active" };
  }

  issueScopedToken({ actor, tenantId, companyId, membershipId, role }) {
    if (!actor?.id || !tenantId || !companyId || !role) throw Object.assign(new Error("A verified tenant and company membership is required"), { code: "FORBIDDEN", statusCode: 403 });
    return jwt.sign({ ...actor, tenant_id: tenantId, company_id: companyId, membership_id: membershipId || undefined, role }, this.secret, { expiresIn: "8h" });
  }
}

function hashPassword(password) { const salt = crypto.randomBytes(16); const hash = crypto.scryptSync(password, salt, 64); return `${salt.toString("hex")}:${hash.toString("hex")}`; }
function verifyPassword(password, encoded) { const [saltHex, hashHex] = String(encoded).split(":"); if (!saltHex || !hashHex) return false; const expected = Buffer.from(hashHex, "hex"); const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length); return crypto.timingSafeEqual(actual, expected); }

module.exports = { LocalAuthService };
