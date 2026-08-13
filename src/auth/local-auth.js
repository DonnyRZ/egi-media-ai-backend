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

  async signup() {
    throw Object.assign(new Error("Public signup is disabled. An administrator must create the account."), { code: "SIGNUP_DISABLED", statusCode: 410 });
  }

  async provision({ email, password, fullName }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      throw Object.assign(new Error("A valid email is required"), { code: "VALIDATION_ERROR", statusCode: 400 });
    }

    const existing = this.accounts.get(normalizedEmail) || await this.accountStore?.findAny?.(normalizedEmail) || null;
    const hasPassword = Boolean(existing?.passwordHash);
    const name = String(fullName || existing?.fullName || "").trim();

    if (!hasPassword) {
      if (String(password || "").length < 8) {
        throw Object.assign(new Error("Password must be at least 8 characters"), { code: "VALIDATION_ERROR", statusCode: 400 });
      }
      if (!name) {
        throw Object.assign(new Error("Full name is required"), { code: "VALIDATION_ERROR", statusCode: 400 });
      }
    }

    const passwordHash = hasPassword ? existing.passwordHash : hashPassword(password);
    const account = {
      email: normalizedEmail,
      fullName: name || existing?.fullName || null,
      role: existing?.role ?? null,
      actorType: "human",
      passwordHash,
    };
    await this.accountStore?.save?.({ userId: `user:${normalizedEmail}`, email: normalizedEmail, fullName: account.fullName, passwordHash });
    this.accounts.set(normalizedEmail, account);
    return {
      userId: `user:${normalizedEmail}`,
      email: normalizedEmail,
      fullName: account.fullName,
      status: "active",
      reused: Boolean(existing),
    };
  }

  issueScopedToken({ actor, tenantId, companyId, membershipId, role }) {
    const tenantOperator = role === "tenant_owner" || role === "tenant_admin";
    if (!actor?.id || !tenantId || !role || (!companyId && !tenantOperator)) throw Object.assign(new Error("A verified tenant and company membership is required"), { code: "FORBIDDEN", statusCode: 403 });
    return jwt.sign({
      ...actor,
      tenant_id: tenantId,
      ...(companyId ? { company_id: companyId } : {}),
      ...(membershipId ? { membership_id: membershipId } : {}),
      role,
    }, this.secret, { expiresIn: "8h" });
  }
}

function hashPassword(password) { const salt = crypto.randomBytes(16); const hash = crypto.scryptSync(password, salt, 64); return `${salt.toString("hex")}:${hash.toString("hex")}`; }
function verifyPassword(password, encoded) { const [saltHex, hashHex] = String(encoded).split(":"); if (!saltHex || !hashHex) return false; const expected = Buffer.from(hashHex, "hex"); const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length); return crypto.timingSafeEqual(actual, expected); }

module.exports = { LocalAuthService };
